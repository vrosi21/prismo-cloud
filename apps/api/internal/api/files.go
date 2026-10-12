package api

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"prismocloud/internal/blob"
	"prismocloud/internal/store"
)

// Types a browser may render in place. Everything else is sent as a download,
// so an uploaded HTML or SVG file can never run script on this origin.
var inlineSafe = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
	"image/avif": true, "image/bmp": true, "video/mp4": true, "video/webm": true,
}

const (
	cacheForever = "private, max-age=31536000, immutable" // URL names one exact file
	cachePublic  = "public, max-age=86400"                // slug URL: owner may unshare
	cacheNone    = "private, no-store"
)

// serveAsset streams the original file or one of its variants.
func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request, a store.Asset, role, cache string) {
	var sha, mimeType string
	name := a.Filename
	if role == "" || role == "original" {
		if a.BlobSHA == nil {
			writeErr(w, http.StatusNotFound, "file is not ready")
			return
		}
		sha, mimeType = *a.BlobSHA, a.Mime
	} else {
		v := a.Variant(role)
		if v == nil {
			writeErr(w, http.StatusNotFound, "no such version of this file")
			return
		}
		sha, mimeType = v.BlobSHA, v.Mime
		name = strings.TrimSuffix(name, path.Ext(name)) + extByMime[v.Mime]
	}
	if name == "" {
		name = a.Slug + extByMime[mimeType]
	}

	obj, modified, err := s.blob.Open(r.Context(), blob.Key(sha))
	if err != nil {
		if blob.IsNotFound(err) {
			writeErr(w, http.StatusNotFound, "file is missing from storage")
			return
		}
		serverError(w, r, err)
		return
	}
	defer obj.Close()

	disposition := "attachment"
	if inlineSafe[mimeType] && r.URL.Query().Get("download") != "1" {
		disposition = "inline"
	}
	if cd := mime.FormatMediaType(disposition, map[string]string{"filename": name}); cd != "" {
		disposition = cd
	}
	h := w.Header()
	contentType := mimeType
	if !inlineSafe[mimeType] {
		// Never label a download as HTML, SVG or script on this origin, even
		// though the attachment header already keeps it from rendering.
		contentType = "application/octet-stream"
	}
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", disposition)
	h.Set("ETag", `"`+sha+`"`)
	h.Set("Cache-Control", cache)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	// ServeContent answers Range and If-None-Match, which video players and
	// caches rely on.
	http.ServeContent(w, r, "", modified, obj)
}

// assetFile serves a file to its owner (trashed or not) and to anyone it is
// shared with.
func (s *Server) assetFile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	a, _, err := s.assetAccess(r.Context(), who(r), id)
	if s.assetErr(w, r, err) {
		return
	}
	cache := cacheNone
	if r.URL.Query().Get("v") != "" {
		cache = cacheForever
	}
	s.serveAsset(w, r, a, r.URL.Query().Get("variant"), cache)
}

// waitReady loads a shared asset, giving a fresh upload up to 20 seconds to
// finish processing. A link pasted into a chat right after capture then
// resolves instead of failing.
func (s *Server) waitReady(ctx context.Context, slug string) (store.Asset, error) {
	deadline := time.Now().Add(20 * time.Second)
	for {
		a, err := s.store.AssetBySlug(ctx, slug)
		if err != nil {
			return a, err
		}
		if a.Status == "ready" || a.Status == "failed" || time.Now().After(deadline) {
			return a, nil
		}
		select {
		case <-ctx.Done():
			return a, ctx.Err()
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// canView: assets shared by link are open to anyone holding the link; private
// ones only to their owner and the people they were shared with.
func (s *Server) canView(r *http.Request, a store.Asset) bool {
	if a.Visibility != "private" {
		return true
	}
	p, err := s.authenticate(r)
	if err != nil || p == nil || p.Level < levelDevice {
		return false
	}
	if p.UserID == a.OwnerID {
		return true
	}
	key := p.shareKey()
	if key == "" {
		return false
	}
	role, err := s.store.ShareRole(r.Context(), key, a.ID, a.CollectionID)
	return err == nil && role != ""
}

func (s *Server) sharedAsset(w http.ResponseWriter, r *http.Request, slug string) (store.Asset, bool) {
	a, err := s.waitReady(r.Context(), slug)
	if errors.Is(err, store.ErrNotFound) || (err == nil && !s.canView(r, a)) {
		// Same answer for "does not exist" and "not yours": a private link
		// must not confirm that it exists.
		writeErr(w, http.StatusNotFound, "not found")
		return a, false
	}
	if err != nil {
		if r.Context().Err() == nil {
			serverError(w, r, err)
		}
		return a, false
	}
	return a, true
}

// publicFile answers /i/{slug} and /i/{slug}.{ext}. The extension picks a
// version: .gif of a recording is its GIF, .mp4 of a GIF is its video.
func (s *Server) publicFile(w http.ResponseWriter, r *http.Request) {
	slug, ext, _ := strings.Cut(chi.URLParam(r, "name"), ".")
	a, ok := s.sharedAsset(w, r, slug)
	if !ok {
		return
	}
	role := r.URL.Query().Get("variant")
	if role == "" {
		switch strings.ToLower(ext) {
		case "gif":
			if a.Mime != "image/gif" {
				role = "gif"
			}
		case "mp4":
			if a.Mime != "video/mp4" {
				role = "mp4"
			}
		}
	}
	cache := cachePublic
	if a.Visibility == "private" {
		cache = cacheNone
	}
	s.serveAsset(w, r, a, role, cache)
}

type sharePageData struct {
	Title     string
	PageURL   string
	RawURL    string
	ThumbURL  string
	VideoURL  string
	VideoMime string
	Mime      string
	Size      string
	Width     int
	Height    int
	IsImage   bool
	IsVideo   bool
	Failed    bool
}

// sharePage is the human-facing link. Its meta tags are what chat apps read
// to build an inline preview.
func (s *Server) sharePage(w http.ResponseWriter, r *http.Request) {
	a, ok := s.sharedAsset(w, r, chi.URLParam(r, "slug"))
	if !ok {
		return
	}
	v := s.view(a)
	d := sharePageData{
		Title:   a.Title,
		PageURL: v.URLs["share"],
		RawURL:  v.URLs["raw"],
		Mime:    a.Mime,
		Size:    humanBytes(a.Bytes),
		Failed:  a.Status != "ready",
	}
	if d.Title == "" {
		d.Title = a.Filename
	}
	if d.Title == "" {
		d.Title = "Prismo Cloud"
	}
	if a.Width != nil && a.Height != nil {
		d.Width, d.Height = *a.Width, *a.Height
	}
	base := s.cfg.PublicURL + "/i/" + a.Slug
	if a.Variant("thumb") != nil {
		d.ThumbURL = base + "?variant=thumb"
	}
	switch {
	case a.Kind == "video":
		d.IsVideo, d.VideoURL, d.VideoMime = true, v.URLs["raw"], a.Mime
		if a.Mime != "video/mp4" && a.Mime != "video/webm" && a.Variant("mp4") != nil {
			d.VideoURL, d.VideoMime = base+".mp4", "video/mp4"
		}
	case inlineSafe[a.Mime]:
		d.IsImage = true
	}

	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
	if a.Visibility != "public" {
		h.Set("X-Robots-Tag", "noindex")
	}
	_ = sharePageTmpl.Execute(w, d)
}

func humanBytes(n int64) string {
	const units = "KMGT"
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	v, i := float64(n)/1024, 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	return fmt.Sprintf("%.1f %cB", v, units[i])
}
