package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"prismocloud/internal/auth"
	"prismocloud/internal/store"
)

// Sharing with a specific person. The owner picks a jar or an item, a Google
// account and a role; that account can then sign in and reach exactly that.
//
// Sharing by link is a different thing (an asset's visibility) and stays
// read-only: a link can be forwarded, so it must never be able to change or
// delete anything.

type shareView struct {
	store.Share
	// The link to send to the invited person. Opening it shows which account
	// was invited; it does not let anyone in by itself.
	InviteURL string `json:"invite_url"`
}

func (s *Server) shareView(sh store.Share) shareView {
	return shareView{Share: sh, InviteURL: s.cfg.PublicURL + "/?invite=" + sh.Invite}
}

func validRole(role string) bool { return role == store.RoleView || role == store.RoleEdit }

// shareTarget reads "exactly one of collection / asset" from two optional ids.
func shareTarget(collection, asset string) (collectionID, assetID *string, ok bool) {
	switch {
	case collection != "" && asset == "" && isUUID(collection):
		return &collection, nil, true
	case asset != "" && collection == "" && isUUID(asset):
		return nil, &asset, true
	}
	return nil, nil, false
}

func (s *Server) listShares(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	collectionID, assetID, ok := shareTarget(q.Get("collection"), q.Get("asset"))
	if !ok {
		writeErr(w, http.StatusBadRequest, "name one jar (collection=) or one item (asset=)")
		return
	}
	shares, err := s.store.ListShares(r.Context(), who(r).UserID, collectionID, assetID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	views := make([]shareView, len(shares))
	for i, sh := range shares {
		views[i] = s.shareView(sh)
	}
	writeJSON(w, http.StatusOK, map[string]any{"shares": views})
}

func (s *Server) createShare(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CollectionID string `json:"collection_id"`
		AssetID      string `json:"asset_id"`
		Email        string `json:"email"`
		Role         string `json:"role"`
	}
	if !decode(w, r, &req) {
		return
	}
	p := who(r)
	collectionID, assetID, ok := shareTarget(req.CollectionID, req.AssetID)
	if !ok {
		writeErr(w, http.StatusBadRequest, "name one jar (collection_id) or one item (asset_id)")
		return
	}
	if !validRole(req.Role) {
		writeErr(w, http.StatusBadRequest, `role must be "view" or "edit"`)
		return
	}
	if !auth.LooksLikeEmail(req.Email) {
		writeErr(w, http.StatusBadRequest, "that does not look like an email address")
		return
	}
	// Kept as typed for showing, compared in normalised form.
	email := strings.ToLower(strings.TrimSpace(req.Email))
	key := auth.EmailKey(email)
	if key == p.shareKey() {
		writeErr(w, http.StatusBadRequest, "that is your own account")
		return
	}

	// Only what the caller owns can be shared: nobody passes on access they
	// were given.
	var sh store.Share
	var err error
	if collectionID != nil {
		var owned bool
		if owned, err = s.store.CollectionExists(r.Context(), p.UserID, *collectionID); err == nil && !owned {
			err = store.ErrNotFound
		}
		if err == nil {
			sh, err = s.store.ShareCollection(r.Context(), p.UserID, *collectionID, email, key, req.Role, auth.NewSecret())
		}
	} else {
		if _, err = s.store.GetAsset(r.Context(), p.UserID, *assetID); err == nil {
			sh, err = s.store.ShareAsset(r.Context(), p.UserID, *assetID, email, key, req.Role, auth.NewSecret())
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.shareView(sh))
}

func (s *Server) updateShare(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Role string `json:"role"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !validRole(req.Role) {
		writeErr(w, http.StatusBadRequest, `role must be "view" or "edit"`)
		return
	}
	sh, err := s.store.UpdateShareRole(r.Context(), who(r).UserID, id, req.Role)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, s.shareView(sh))
}

func (s *Server) deleteShare(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	err := s.store.DeleteShare(r.Context(), who(r).UserID, id)
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

var inviteRe = regexp.MustCompile(`^[0-9A-Za-z]{40}$`)

// inviteInfo is public: it is what the sign-in page shows someone who opened
// an invitation link, so they know which Google account to use. The token is
// 40 random characters and reveals nothing but that one invitation.
func (s *Server) inviteInfo(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if !inviteRe.MatchString(token) {
		writeErr(w, http.StatusNotFound, "this invitation does not exist any more")
		return
	}
	in, err := s.store.InviteByToken(r.Context(), token)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "this invitation does not exist any more")
		return
	}
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, in)
}

// sharedWithMe lists what other people shared with the caller: whole folders,
// and items shared on their own.
func (s *Server) sharedWithMe(w http.ResponseWriter, r *http.Request) {
	type sharedItem struct {
		assetView
		Owner string `json:"owner"`
	}
	folders, items := []store.SharedFolder{}, []sharedItem{}
	if key := who(r).shareKey(); key != "" {
		var err error
		if folders, err = s.store.SharedFolders(r.Context(), key); err != nil {
			serverError(w, r, err)
			return
		}
		shared, err := s.store.SharedItems(r.Context(), key)
		if err != nil {
			serverError(w, r, err)
			return
		}
		for _, sa := range shared {
			level := accessView
			if sa.Role == store.RoleEdit {
				level = accessEdit
			}
			items = append(items, sharedItem{assetView: s.viewAs(sa.Asset, level), Owner: sa.Owner})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": folders, "items": items})
}

// sharedFolderAssets shows a folder that was shared with the caller, or a
// folder inside one: its subfolders, the path back up to the shared folder,
// and one page of its files.
func (s *Server) sharedFolderAssets(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	access, err := s.store.FolderAccess(r.Context(), who(r).shareKey(), id)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if access.Role == "" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	subfolders, err := s.store.ChildCollections(r.Context(), id)
	if err != nil {
		serverError(w, r, err)
		return
	}
	level := accessView
	if access.Role == store.RoleEdit {
		level = accessEdit
	}
	// Owner and folder come from the share, so the caller cannot widen the
	// listing to the rest of the owner's library.
	f := store.AssetFilter{OwnerID: access.OwnerID, CollectionID: id}
	s.writeAssetPage(w, r, f, level, map[string]any{
		"folder":  map[string]string{"id": id, "name": access.Name, "role": access.Role},
		"crumbs":  access.Crumbs,
		"folders": subfolders,
	})
}
