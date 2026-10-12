package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"prismocloud/internal/auth"
	"prismocloud/internal/blob"
	"prismocloud/internal/store"
)

var (
	shaRe    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	sourceRe = regexp.MustCompile(`^[a-z0-9_-]{1,20}$`)
)

var mimeByExt = func() map[string]string {
	m := map[string]string{".jpeg": "image/jpeg"}
	for mime, ext := range extByMime {
		m[ext] = mime
	}
	return m
}()

// uploadOptions are the choices a client may send along with a file, in
// either upload flow.
type uploadOptions struct {
	Title        string
	Tags         []string
	Visibility   string
	Kind         string
	Source       string
	Collection   string  // by path such as "screenshots/2026", created when missing
	CollectionID *string // by id

	// Filled in by resolve.
	OwnerID string // whose library the file goes into
	Shared  bool   // true when that is someone else's folder, shared with edit rights
}

// resolve validates the options and fills in defaults. A non-empty message
// means the client sent something invalid.
func (s *Server) resolve(ctx context.Context, p *principal, o *uploadOptions) (msg string, err error) {
	if len(o.Title) > 200 {
		return "title is too long", nil
	}
	if o.Tags = cleanTags(o.Tags); o.Tags == nil {
		return "too many tags, or a tag is too long", nil
	}
	if o.Visibility == "" {
		// Capture clients share by default, the web app does not; the token
		// carries the choice made for that client.
		o.Visibility = "private"
		if p.Token != nil {
			o.Visibility = p.Token.DefaultVisibility
		}
	}
	if !validVisibility(o.Visibility) {
		return "unknown visibility", nil
	}
	switch o.Kind {
	case "sticker":
	case "":
		o.Kind = "file" // placeholder until the worker has looked at the bytes
	default:
		return `kind may only be set to "sticker"; other kinds are detected`, nil
	}
	if p.Level == levelSession {
		o.Source = "web"
	} else if o.Source == "" {
		o.Source = "api"
	} else if !sourceRe.MatchString(o.Source) {
		return "bad source", nil
	}
	o.OwnerID = p.UserID
	if o.CollectionID != nil {
		if !isUUID(*o.CollectionID) {
			return "bad collection id", nil
		}
		ok, err := s.store.CollectionExists(ctx, p.UserID, *o.CollectionID)
		if err != nil {
			return "", err
		}
		if !ok {
			// Not the caller's folder. It may be one shared with them for editing:
			// then the file goes into the folder owner's library, private, and
			// nothing about how it is shared is the uploader's to choose.
			access, err := s.store.FolderAccess(ctx, p.shareKey(), *o.CollectionID)
			if err != nil {
				return "", err
			}
			if access.Role != store.RoleEdit {
				return "no such collection", nil
			}
			o.OwnerID, o.Shared = access.OwnerID, true
			o.Visibility, o.Kind, o.Source = "private", "file", "guest"
		}
	} else if !p.Member {
		return "guests can only add files to a folder shared with them", nil
	} else if strings.TrimSpace(o.Collection) != "" {
		path, ok := cleanPath(o.Collection)
		if !ok {
			return "bad folder path", nil
		}
		c, err := s.store.CollectionByPath(ctx, p.UserID, path)
		if err != nil {
			return "", err
		}
		o.CollectionID = &c.ID
	}
	return "", nil
}

func (o uploadOptions) newAsset(p *principal, filename string) store.NewAsset {
	mime := mimeByExt[cleanExt(filename)]
	if mime == "" {
		mime = "application/octet-stream"
	}
	return store.NewAsset{
		OwnerID:      o.OwnerID,
		CollectionID: o.CollectionID,
		Kind:         o.Kind,
		Title:        o.Title,
		Filename:     filename,
		Mime:         mime,
		Visibility:   o.Visibility,
		Slug:         auth.NewSlug(),
		Source:       o.Source,
		Tags:         o.Tags,
	}
}

func cleanFilename(name string) string {
	name = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == '/' || r == '\\' || r == 0x7f {
			return -1
		}
		return r
	}, name))
	if len(name) > 200 {
		name = name[len(name)-200:]
	}
	return name
}

// createAsset starts a direct-to-storage upload: it records the asset as
// pending and hands back a short-lived URL the client PUTs the bytes to.
func (s *Server) createAsset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Filename     string   `json:"filename"`
		Bytes        int64    `json:"bytes"`
		SHA256       string   `json:"sha256"`
		Title        string   `json:"title"`
		Tags         []string `json:"tags"`
		Visibility   string   `json:"visibility"`
		Kind         string   `json:"kind"`
		Source       string   `json:"source"`
		Collection   string   `json:"collection"`
		CollectionID *string  `json:"collection_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	p := who(r)
	if req.Bytes <= 0 {
		writeErr(w, http.StatusBadRequest, "bytes must be the file size")
		return
	}
	if req.Bytes > s.cfg.MaxUploadBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "file is larger than the upload limit")
		return
	}
	req.SHA256 = strings.ToLower(req.SHA256)
	if req.SHA256 != "" && !shaRe.MatchString(req.SHA256) {
		writeErr(w, http.StatusBadRequest, "sha256 must be 64 hex characters")
		return
	}
	opts := uploadOptions{Title: req.Title, Tags: req.Tags, Visibility: req.Visibility, Kind: req.Kind,
		Source: req.Source, Collection: req.Collection, CollectionID: req.CollectionID}
	if msg, err := s.resolve(r.Context(), p, &opts); err != nil {
		serverError(w, r, err)
		return
	} else if msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}

	// Same file already in this library: skip the upload entirely.
	// (Never for a guest: the answer would reveal what else the owner has.)
	if req.SHA256 != "" && !opts.Shared {
		existing, err := s.store.AssetByBlob(r.Context(), p.UserID, req.SHA256)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"asset": s.view(existing), "duplicate": true})
			return
		}
		if !errors.Is(err, store.ErrNotFound) {
			serverError(w, r, err)
			return
		}
	}

	n := opts.newAsset(p, cleanFilename(req.Filename))
	n.Status, n.Bytes = "pending", req.Bytes
	if req.SHA256 != "" {
		n.ExpectedSHA = &req.SHA256
	}
	a, err := store.CreateAsset(r.Context(), s.store.Pool, n)
	if err != nil {
		serverError(w, r, err)
		return
	}
	putURL, err := s.blob.PresignPut(r.Context(), blob.StagingKey(a.ID), 15*time.Minute)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"asset":     s.view(a),
		"duplicate": false,
		"upload":    map[string]any{"method": "PUT", "url": putURL},
	})
}

// completeAsset is called after the client finished its PUT. The size is
// checked here; the content itself is verified by the worker.
func (s *Server) completeAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	p := who(r)
	// The uploader is the owner, or a guest with edit rights on the folder.
	a, level, err := s.assetAccess(r.Context(), p, id)
	if s.assetErr(w, r, err) {
		return
	}
	if level < accessEdit {
		writeErr(w, http.StatusForbidden, "you can only view this")
		return
	}
	if a.Status != "pending" {
		writeJSON(w, http.StatusOK, s.viewAs(a, level)) // already completed: nothing to do
		return
	}
	key := blob.StagingKey(a.ID)
	size, err := s.blob.Size(r.Context(), key)
	if err != nil {
		serverError(w, r, err)
		return
	}
	switch {
	case size < 0:
		writeErr(w, http.StatusBadRequest, "no uploaded file found for this asset")
		return
	case size != a.Bytes || size > s.cfg.MaxUploadBytes:
		_ = s.blob.Remove(r.Context(), key)
		writeErr(w, http.StatusBadRequest, "uploaded file does not match the announced size")
		return
	}
	a, err = s.startProcessing(r.Context(), func(tx pgx.Tx) (store.Asset, error) {
		return store.MarkUploaded(r.Context(), tx, a.OwnerID, id, size)
	})
	if s.assetErr(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.viewAs(a, level))
}

// startProcessing runs change and queues the processing job in one
// transaction: either both happen or neither does.
func (s *Server) startProcessing(ctx context.Context, change func(pgx.Tx) (store.Asset, error)) (store.Asset, error) {
	var a store.Asset
	err := pgx.BeginFunc(ctx, s.store.Pool, func(tx pgx.Tx) error {
		var err error
		if a, err = change(tx); err != nil {
			return err
		}
		return store.Enqueue(ctx, tx, store.JobProcessAsset, store.AssetJob{AssetID: a.ID})
	})
	return a, err
}

type byteCounter int64

func (c *byteCounter) Write(p []byte) (int, error) {
	*c += byteCounter(len(p))
	return len(p), nil
}

// uploadDirect accepts one multipart POST and streams it to storage. It
// exists for clients that cannot do the two-step flow, such as ShareX.
func (s *Server) uploadDirect(w http.ResponseWriter, r *http.Request) {
	p := who(r)
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes+(1<<20))
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "expected multipart/form-data with a file field")
		return
	}

	fields := r.URL.Query()
	var (
		id, filename, sha string
		size              byteCounter
	)
	// The request context ends when the client goes away; cleanup must still run.
	cleanup := func() {
		if id != "" {
			_ = s.blob.Remove(context.WithoutCancel(r.Context()), blob.StagingKey(id))
		}
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			cleanup()
			uploadReadError(w, err)
			return
		}
		if part.FileName() == "" {
			value, _ := io.ReadAll(io.LimitReader(part, 4096))
			fields.Set(part.FormName(), string(value))
			continue
		}
		if id != "" {
			continue // one file per request; extra files are ignored
		}
		id, filename = auth.NewUUIDv7(), cleanFilename(part.FileName())
		hash := sha256.New()
		body := io.TeeReader(part, io.MultiWriter(hash, &size))
		if _, err := s.blob.Put(r.Context(), blob.StagingKey(id), body, "application/octet-stream"); err != nil {
			cleanup()
			uploadReadError(w, err)
			return
		}
		sha = hex.EncodeToString(hash.Sum(nil))
	}
	if id == "" || size == 0 {
		cleanup()
		writeErr(w, http.StatusBadRequest, "no file in request")
		return
	}
	if int64(size) > s.cfg.MaxUploadBytes {
		cleanup()
		writeErr(w, http.StatusRequestEntityTooLarge, "file is larger than the upload limit")
		return
	}

	opts := uploadOptions{Title: fields.Get("title"), Visibility: fields.Get("visibility"),
		Kind: fields.Get("kind"), Source: fields.Get("source"), Collection: fields.Get("collection")}
	if t := fields.Get("tags"); t != "" {
		opts.Tags = strings.Split(t, ",")
	}
	if cid := fields.Get("collection_id"); cid != "" {
		opts.CollectionID = &cid
	}
	if msg, err := s.resolve(r.Context(), p, &opts); err != nil {
		cleanup()
		serverError(w, r, err)
		return
	} else if msg != "" {
		cleanup()
		writeErr(w, http.StatusBadRequest, msg)
		return
	}

	existing, err := s.store.AssetByBlob(r.Context(), p.UserID, sha)
	if err == nil && !opts.Shared {
		cleanup()
		writeJSON(w, http.StatusOK, s.uploadResult(existing, true))
		return
	}
	if !errors.Is(err, store.ErrNotFound) {
		cleanup()
		serverError(w, r, err)
		return
	}

	n := opts.newAsset(p, filename)
	n.ID, n.Status, n.Bytes, n.ExpectedSHA = &id, "processing", int64(size), &sha
	a, err := s.startProcessing(r.Context(), func(tx pgx.Tx) (store.Asset, error) {
		return store.CreateAsset(r.Context(), tx, n)
	})
	if err != nil {
		cleanup()
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.uploadResult(a, false))
}

func uploadReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) || strings.Contains(err.Error(), "request body too large") {
		writeErr(w, http.StatusRequestEntityTooLarge, "file is larger than the upload limit")
		return
	}
	writeErr(w, http.StatusBadRequest, "upload was interrupted or malformed")
}

// uploadResult is a flat answer for clients that pick one field out of the
// JSON, like ShareX's {json:url}. Links work at once: the public endpoints
// wait for processing to finish instead of answering 404.
func (s *Server) uploadResult(a store.Asset, duplicate bool) map[string]any {
	v := s.view(a)
	base := s.cfg.PublicURL + "/i/" + a.Slug
	// gif_url is always usable: the GIF version for a recording, the file
	// itself for everything else.
	gif := v.URLs["raw"]
	switch cleanExt(a.Filename) {
	case ".mp4", ".webm", ".mov", ".mkv":
		gif = base + ".gif"
	}
	return map[string]any{
		"id":        a.ID,
		"url":       v.URLs["raw"],
		"share_url": v.URLs["share"],
		"gif_url":   gif,
		"thumb_url": base + "?variant=thumb",
		"duplicate": duplicate,
		"asset":     v,
	}
}
