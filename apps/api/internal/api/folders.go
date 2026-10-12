package api

import (
	"errors"
	"net/http"
	"strings"

	"prismocloud/internal/store"
)

// Folders. The database and the API paths still say "collection"; everywhere
// a person reads it, it is a folder.

func cleanName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && len(name) <= 60 && !strings.ContainsAny(name, "/\\")
}

// cleanPath checks a folder path such as "screenshots/2026" and returns it
// with every part trimmed.
func cleanPath(path string) (string, bool) {
	parts := strings.Split(path, "/")
	if len(parts) > store.MaxFolderDepth {
		return "", false
	}
	for i, part := range parts {
		name, ok := cleanName(part)
		if !ok {
			return "", false
		}
		parts[i] = name
	}
	return strings.Join(parts, "/"), true
}

func (s *Server) listCollections(w http.ResponseWriter, r *http.Request) {
	cols, err := s.store.ListCollections(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"collections": cols})
}

// folderError writes the answer for a failed folder change and reports
// whether it did.
func (s *Server) folderError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, store.ErrCycle):
		writeErr(w, http.StatusBadRequest, "a folder cannot be moved into itself or into one of its own subfolders")
	case errors.Is(err, store.ErrTooDeep):
		writeErr(w, http.StatusBadRequest, "folders are nested too deeply")
	case isUniqueViolation(err):
		writeErr(w, http.StatusConflict, "there is already a folder with that name here")
	default:
		serverError(w, r, err)
	}
	return true
}

func (s *Server) createCollection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string  `json:"name"`
		ParentID *string `json:"parent_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	name, ok := cleanName(req.Name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "a folder name is 1 to 60 characters, without slashes")
		return
	}
	owner := who(r).UserID
	if !s.checkCollection(w, r, owner, req.ParentID) {
		return
	}
	c, err := s.store.CreateCollection(r.Context(), owner, name, req.ParentID)
	if s.folderError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// updateCollection renames a folder, moves it, or both.
func (s *Server) updateCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Name     *string        `json:"name"`
		ParentID optionalString `json:"parent_id"` // absent: stay; null: move to the top
	}
	if !decode(w, r, &req) {
		return
	}
	owner := who(r).UserID
	if req.ParentID.Set {
		if p := req.ParentID.Value; p != nil && !isUUID(*p) {
			writeErr(w, http.StatusBadRequest, "bad folder id")
			return
		}
		if s.folderError(w, r, s.store.MoveCollection(r.Context(), owner, id, req.ParentID.Value)) {
			return
		}
	}
	if req.Name != nil {
		name, ok := cleanName(*req.Name)
		if !ok {
			writeErr(w, http.StatusBadRequest, "a folder name is 1 to 60 characters, without slashes")
			return
		}
		if s.folderError(w, r, s.store.RenameCollection(r.Context(), owner, id, name)) {
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// deleteCollection removes a folder and its subfolders. ?files=trash sends
// the files inside to the trash; without it they are kept and move up one
// level.
func (s *Server) deleteCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	trash := r.URL.Query().Get("files") == "trash"
	if s.folderError(w, r, s.store.DeleteCollection(r.Context(), who(r).UserID, id, trash)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
