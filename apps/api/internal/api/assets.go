package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"prismocloud/internal/store"
)

// assetView is an asset as clients see it: the row plus ready-made URLs.
type assetView struct {
	store.Asset
	Variants []string          `json:"variants"`
	URLs     map[string]string `json:"urls"`
}

var extByMime = map[string]string{
	"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
	"image/avif": ".avif", "image/bmp": ".bmp", "video/mp4": ".mp4", "video/webm": ".webm",
	"video/quicktime": ".mov", "video/x-matroska": ".mkv",
}

func extFor(a store.Asset) string {
	if ext, ok := extByMime[a.Mime]; ok {
		return ext
	}
	return cleanExt(a.Filename)
}

// cleanExt returns a short, harmless extension taken from a filename, or "".
func cleanExt(filename string) string {
	ext := strings.ToLower(path.Ext(filename))
	if len(ext) < 2 || len(ext) > 6 {
		return ""
	}
	for _, c := range ext[1:] {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') {
			return ""
		}
	}
	return ext
}

func (s *Server) view(a store.Asset) assetView {
	v := assetView{Asset: a, Variants: []string{}, URLs: map[string]string{}}
	file := "/v1/assets/" + a.ID + "/file"
	// The hash prefix makes each URL name one exact file, so browsers can
	// cache it forever and still see a new file right after a change.
	if a.BlobSHA != nil {
		v.URLs["file"] = file + "?v=" + (*a.BlobSHA)[:12]
	}
	for _, vr := range a.Variants {
		v.Variants = append(v.Variants, vr.Role)
		v.URLs[vr.Role] = file + "?variant=" + vr.Role + "&v=" + vr.BlobSHA[:12]
	}
	public := s.cfg.PublicURL
	v.URLs["share"] = public + "/s/" + a.Slug
	v.URLs["raw"] = public + "/i/" + a.Slug + extFor(a)
	if a.Kind == "video" {
		v.URLs["raw_gif"] = public + "/i/" + a.Slug + ".gif"
	}
	if a.Mime == "image/gif" {
		v.URLs["raw_mp4"] = public + "/i/" + a.Slug + ".mp4"
	}
	return v
}

func validVisibility(v string) bool { return v == "private" || v == "unlisted" || v == "public" }

func validKind(k string) bool {
	switch k {
	case "image", "gif", "video", "sticker", "file":
		return true
	}
	return false
}

// cleanTags trims, lowercases and dedupes; nil result means "invalid".
func cleanTags(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		if len(t) > 40 || len(out) == 30 {
			return nil
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

func (s *Server) listAssets(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := store.AssetFilter{
		OwnerID:      who(r).UserID,
		Trashed:      q.Get("trashed") == "1",
		Kind:         q.Get("kind"),
		CollectionID: q.Get("collection"),
		Tag:          strings.ToLower(strings.TrimSpace(q.Get("tag"))),
		Query:        strings.TrimSpace(q.Get("q")),
		Cursor:       q.Get("cursor"),
		Limit:        60,
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil && n > 0 && n <= 200 {
		f.Limit = n
	}
	if f.Kind != "" && !validKind(f.Kind) {
		writeErr(w, http.StatusBadRequest, "unknown kind")
		return
	}
	if f.CollectionID != "" && f.CollectionID != "none" && !isUUID(f.CollectionID) {
		writeErr(w, http.StatusBadRequest, "collection must be an id or \"none\"")
		return
	}
	if f.Cursor != "" && !isUUID(f.Cursor) {
		writeErr(w, http.StatusBadRequest, "bad cursor")
		return
	}

	// Ask for one extra row: its presence tells us another page exists
	// without running a separate count query.
	f.Limit++
	assets, err := s.store.ListAssets(r.Context(), f)
	if err != nil {
		serverError(w, r, err)
		return
	}
	var next *string
	if len(assets) == f.Limit {
		assets = assets[:f.Limit-1]
		next = &assets[len(assets)-1].ID
	}
	views := make([]assetView, len(assets))
	for i, a := range assets {
		views[i] = s.view(a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": views, "next_cursor": next})
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	a, err := s.store.GetAsset(r.Context(), who(r).UserID, id)
	if s.assetErr(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.view(a))
}

// assetErr writes the response for a failed asset lookup and reports whether
// it did so.
func (s *Server) assetErr(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	default:
		serverError(w, r, err)
	}
	return true
}

func (s *Server) updateAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// collection_id may be absent (leave alone) or null (remove), so a plain
	// *string is not enough to tell the two apart.
	var req struct {
		Title        *string        `json:"title"`
		Tags         *[]string      `json:"tags"`
		Visibility   *string        `json:"visibility"`
		Kind         *string        `json:"kind"`
		CollectionID optionalString `json:"collection_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	owner := who(r).UserID
	p := store.AssetPatch{Title: req.Title, Visibility: req.Visibility, Kind: req.Kind}
	if p.Title != nil && len(*p.Title) > 200 {
		writeErr(w, http.StatusBadRequest, "title is too long")
		return
	}
	if p.Visibility != nil && !validVisibility(*p.Visibility) {
		writeErr(w, http.StatusBadRequest, "unknown visibility")
		return
	}
	if p.Kind != nil && !validKind(*p.Kind) {
		writeErr(w, http.StatusBadRequest, "unknown kind")
		return
	}
	if req.Tags != nil {
		tags := cleanTags(*req.Tags)
		if tags == nil {
			writeErr(w, http.StatusBadRequest, "too many tags, or a tag is too long")
			return
		}
		p.Tags = &tags
	}
	if req.CollectionID.Set {
		if !s.checkCollection(w, r, owner, req.CollectionID.Value) {
			return
		}
		p.SetCollection, p.CollectionID = true, req.CollectionID.Value
	}
	a, err := s.store.UpdateAsset(r.Context(), owner, id, p)
	if s.assetErr(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, s.view(a))
}

// optionalString records whether a JSON field was present at all.
type optionalString struct {
	Set   bool
	Value *string
}

func (o *optionalString) UnmarshalJSON(b []byte) error {
	o.Set = true
	return json.Unmarshal(b, &o.Value)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// checkCollection verifies a collection id belongs to the owner (nil is fine).
func (s *Server) checkCollection(w http.ResponseWriter, r *http.Request, owner string, id *string) bool {
	if id == nil {
		return true
	}
	if !isUUID(*id) {
		writeErr(w, http.StatusBadRequest, "bad collection id")
		return false
	}
	ok, err := s.store.CollectionExists(r.Context(), owner, *id)
	if err != nil {
		serverError(w, r, err)
		return false
	}
	if !ok {
		writeErr(w, http.StatusBadRequest, "no such collection")
		return false
	}
	return true
}

// deleteAsset moves an asset to the trash; ?permanent=1 removes one that is
// already there for good.
func (s *Server) deleteAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	owner := who(r).UserID
	var n int64
	var err error
	if r.URL.Query().Get("permanent") == "1" {
		n, err = s.store.PurgeAssets(r.Context(), owner, []string{id})
	} else {
		n, err = s.store.TrashAssets(r.Context(), owner, []string{id})
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restoreAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	n, err := s.store.RestoreAssets(r.Context(), who(r).UserID, []string{id})
	if err != nil {
		serverError(w, r, err)
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) bulkAssets(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs          []string `json:"ids"`
		Action       string   `json:"action"`
		CollectionID *string  `json:"collection_id"`
		Visibility   string   `json:"visibility"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 500 {
		writeErr(w, http.StatusBadRequest, "send between 1 and 500 ids")
		return
	}
	for _, id := range req.IDs {
		if !isUUID(id) {
			writeErr(w, http.StatusBadRequest, "bad id in list")
			return
		}
	}
	owner := who(r).UserID
	var n int64
	var err error
	switch req.Action {
	case "trash":
		n, err = s.store.TrashAssets(r.Context(), owner, req.IDs)
	case "restore":
		n, err = s.store.RestoreAssets(r.Context(), owner, req.IDs)
	case "purge":
		n, err = s.store.PurgeAssets(r.Context(), owner, req.IDs)
	case "collection":
		if !s.checkCollection(w, r, owner, req.CollectionID) {
			return
		}
		n, err = s.store.SetAssetsCollection(r.Context(), owner, req.IDs, req.CollectionID)
	case "visibility":
		if !validVisibility(req.Visibility) {
			writeErr(w, http.StatusBadRequest, "unknown visibility")
			return
		}
		n, err = s.store.SetAssetsVisibility(r.Context(), owner, req.IDs, req.Visibility)
	default:
		writeErr(w, http.StatusBadRequest, "unknown action")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"changed": n})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.Stats(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) tags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.store.Tags(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

// --- Collections --------------------------------------------------------------

func cleanName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && len(name) <= 60
}

func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) {
	cols, err := s.store.ListCollections(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"collections": cols})
}

func (s *Server) createCollection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "name is required (60 characters at most)")
		return
	}
	c, err := s.store.CollectionByName(r.Context(), who(r).UserID, name)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) renameCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "name is required (60 characters at most)")
		return
	}
	err := s.store.RenameCollection(r.Context(), who(r).UserID, id, name)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case isUniqueViolation(err):
		writeErr(w, http.StatusConflict, "a collection with that name already exists")
	case err != nil:
		serverError(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteCollection(r.Context(), who(r).UserID, id)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
