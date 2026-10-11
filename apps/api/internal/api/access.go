package api

import (
	"context"

	"prismocloud/internal/store"
)

// What a caller may do with one asset, weakest first.
const (
	accessNone  = iota
	accessView  // look at it and download it
	accessEdit  // also rename, tag, move to trash; add files to a shared jar
	accessOwner // everything, including who else gets in
)

var accessName = [...]string{"", store.RoleView, store.RoleEdit, "owner"}

// assetAccess loads an asset and works out what the caller may do with it:
// everything if they own it, otherwise whatever a share on the asset or on
// its jar grants. "Does not exist" and "not yours to see" come back as the
// same error, so an id tells a stranger nothing.
func (s *Server) assetAccess(ctx context.Context, p *principal, id string) (store.Asset, int, error) {
	a, err := s.store.AssetWithVariants(ctx, id)
	if err != nil {
		return a, accessNone, err
	}
	if a.OwnerID == p.UserID {
		return a, accessOwner, nil
	}
	key := p.shareKey()
	// Things in the trash are the owner's business only.
	if key == "" || a.DeletedAt != nil {
		return store.Asset{}, accessNone, store.ErrNotFound
	}
	role, err := s.store.ShareRole(ctx, key, a.ID, a.CollectionID)
	if err != nil {
		return store.Asset{}, accessNone, err
	}
	switch role {
	case store.RoleEdit:
		return a, accessEdit, nil
	case store.RoleView:
		return a, accessView, nil
	}
	return store.Asset{}, accessNone, store.ErrNotFound
}

// viewAs is view for a caller who may not be the owner.
func (s *Server) viewAs(a store.Asset, level int) assetView {
	v := s.view(a)
	v.Access = accessName[level]
	return v
}
