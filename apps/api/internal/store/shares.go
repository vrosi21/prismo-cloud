package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	RoleView = "view"
	RoleEdit = "edit"
)

type Share struct {
	ID           string    `json:"id"`
	OwnerID      string    `json:"-"`
	CollectionID *string   `json:"collection_id"`
	AssetID      *string   `json:"asset_id"`
	Email        string    `json:"email"`
	Role         string    `json:"role"`
	Invite       string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

const shareCols = `id::text, owner_id::text, collection_id::text, asset_id::text, email, role, invite, created_at`

func scanShare(row pgx.Row) (Share, error) {
	var sh Share
	err := row.Scan(&sh.ID, &sh.OwnerID, &sh.CollectionID, &sh.AssetID, &sh.Email, &sh.Role, &sh.Invite, &sh.CreatedAt)
	return sh, notFound(err)
}

// ShareCollection gives an account access to a folder. Sharing again with the
// same account changes the role and keeps the existing invitation link.
func (s *Store) ShareCollection(ctx context.Context, ownerID, collectionID, email, emailKey, role, invite string) (Share, error) {
	return scanShare(s.Pool.QueryRow(ctx,
		`insert into shares (owner_id, collection_id, email, email_key, role, invite) values ($1, $2, $3, $4, $5, $6)
		 on conflict (collection_id, email_key) where collection_id is not null
		 do update set role = excluded.role
		 returning `+shareCols, ownerID, collectionID, email, emailKey, role, invite))
}

func (s *Store) ShareAsset(ctx context.Context, ownerID, assetID, email, emailKey, role, invite string) (Share, error) {
	return scanShare(s.Pool.QueryRow(ctx,
		`insert into shares (owner_id, asset_id, email, email_key, role, invite) values ($1, $2, $3, $4, $5, $6)
		 on conflict (asset_id, email_key) where asset_id is not null
		 do update set role = excluded.role
		 returning `+shareCols, ownerID, assetID, email, emailKey, role, invite))
}

// ListShares returns who a folder or an item of this owner is shared with.
func (s *Store) ListShares(ctx context.Context, ownerID string, collectionID, assetID *string) ([]Share, error) {
	rows, err := s.Pool.Query(ctx,
		`select `+shareCols+` from shares
		 where owner_id = $1
		   and (($2::uuid is not null and collection_id = $2) or ($3::uuid is not null and asset_id = $3))
		 order by id`, ownerID, collectionID, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Share{}
	for rows.Next() {
		sh, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) UpdateShareRole(ctx context.Context, ownerID, id, role string) (Share, error) {
	return scanShare(s.Pool.QueryRow(ctx,
		`update shares set role = $3 where owner_id = $1 and id = $2 returning `+shareCols, ownerID, id, role))
}

func (s *Store) DeleteShare(ctx context.Context, ownerID, id string) error {
	tag, err := s.Pool.Exec(ctx, `delete from shares where owner_id = $1 and id = $2`, ownerID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// The lookups below take the account in normalised form (auth.EmailKey).

// HasShares reports whether anything at all is shared with this account,
// which is what lets a person who is not on the member list sign in.
func (s *Store) HasShares(ctx context.Context, email string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from shares where email_key = $1)`, email).Scan(&ok)
	return ok, err
}

// Invite is what an invitation link may reveal to whoever opens it.
type Invite struct {
	Email        string  `json:"email"`
	Role         string  `json:"role"`
	Owner        string  `json:"owner"`
	Name         string  `json:"name"`
	CollectionID *string `json:"collection_id"`
	AssetID      *string `json:"asset_id"`
}

func (s *Store) InviteByToken(ctx context.Context, token string) (Invite, error) {
	var in Invite
	err := s.Pool.QueryRow(ctx,
		`select s.email, s.role, u.email, s.collection_id::text, s.asset_id::text,
		        coalesce(c.name, nullif(a.title, ''), a.filename, '')
		 from shares s
		 join users u on u.id = s.owner_id
		 left join collections c on c.id = s.collection_id
		 left join assets a on a.id = s.asset_id
		 where s.invite = $1`, token).
		Scan(&in.Email, &in.Role, &in.Owner, &in.CollectionID, &in.AssetID, &in.Name)
	return in, notFound(err)
}

// ShareRole says what an account may do with an asset it does not own:
// "" (nothing), RoleView or RoleEdit. A share on the asset itself counts, and
// so does a share on its folder or on any folder above that one: sharing a
// folder shares everything inside it. The strongest of them wins.
func (s *Store) ShareRole(ctx context.Context, email, assetID string, collectionID *string) (string, error) {
	var level int
	err := s.Pool.QueryRow(ctx,
		`with recursive up as (
		     select id, parent_id from collections where id = $3
		     union all
		     select c.id, c.parent_id from collections c join up on c.id = up.parent_id)
		 select coalesce(max(case role when 'edit' then 2 else 1 end), 0) from shares
		 where email_key = $1 and (asset_id = $2 or collection_id in (select id from up))`,
		email, assetID, collectionID).Scan(&level)
	return [...]string{"", RoleView, RoleEdit}[level], err
}

// Crumb is one step of the path to a folder.
type Crumb struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// FolderAccess is what an account may do with a folder it does not own.
type FolderAccess struct {
	Role    string // "" when the folder is not shared with the account
	OwnerID string
	Name    string
	// Crumbs is the path the account may walk: from the topmost folder that
	// was shared with it down to this one. Folders above that stay unseen.
	Crumbs []Crumb
}

// FolderAccess works out an account's rights on a folder. The folder may be
// shared itself or lie inside a shared folder.
func (s *Store) FolderAccess(ctx context.Context, email, collectionID string) (FolderAccess, error) {
	rows, err := s.Pool.Query(ctx,
		`with recursive up as (
		     select c.id, c.parent_id, c.name, c.owner_id, 0 as dist from collections c where c.id = $2
		     union all
		     select c.id, c.parent_id, c.name, c.owner_id, up.dist + 1
		     from collections c join up on c.id = up.parent_id)
		 select up.id::text, up.name, up.owner_id::text,
		        coalesce((select s.role from shares s where s.email_key = $1 and s.collection_id = up.id), '')
		 from up order by up.dist desc`, email, collectionID)
	if err != nil {
		return FolderAccess{}, err
	}
	defer rows.Close()
	var fa FolderAccess
	for rows.Next() { // from the top of the tree down to the folder asked about
		var c Crumb
		var role string
		if err := rows.Scan(&c.ID, &c.Name, &fa.OwnerID, &role); err != nil {
			return FolderAccess{}, err
		}
		if role == RoleEdit || (role == RoleView && fa.Role == "") {
			fa.Role = role
		}
		if fa.Role != "" {
			fa.Crumbs = append(fa.Crumbs, c)
		}
		fa.Name = c.Name
	}
	return fa, rows.Err()
}

// SharedFolder is a folder someone shared with the account directly.
type SharedFolder struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	Owner string `json:"owner"`
	Count int    `json:"count"`
}

func (s *Store) SharedFolders(ctx context.Context, email string) ([]SharedFolder, error) {
	rows, err := s.Pool.Query(ctx,
		`select c.id::text, c.name, s.role, u.email,
		        (select count(*) from assets a
		         where a.collection_id = c.id and a.deleted_at is null and a.status <> 'pending')
		 from shares s
		 join collections c on c.id = s.collection_id
		 join users u on u.id = s.owner_id
		 where s.email_key = $1
		 order by lower(c.name)`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SharedFolder{}
	for rows.Next() {
		var f SharedFolder
		if err := rows.Scan(&f.ID, &f.Name, &f.Role, &f.Owner, &f.Count); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SharedAsset is an item shared on its own (not through a folder).
type SharedAsset struct {
	Asset
	Role  string
	Owner string
}

func (s *Store) SharedItems(ctx context.Context, email string) ([]SharedAsset, error) {
	rows, err := s.Pool.Query(ctx,
		`select `+assetCols+`, s.role, u.email
		 from shares s
		 join assets a on a.id = s.asset_id
		 join users u on u.id = s.owner_id
		 where s.email_key = $1 and a.deleted_at is null and a.status <> 'pending'
		 order by a.id desc limit 500`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SharedAsset{}
	for rows.Next() {
		var sa SharedAsset
		if err := rows.Scan(append(assetDest(&sa.Asset), &sa.Role, &sa.Owner)...); err != nil {
			return nil, err
		}
		if sa.Tags == nil {
			sa.Tags = []string{}
		}
		out = append(out, sa)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ptrs := make([]*Asset, len(out))
	for i := range out {
		ptrs[i] = &out[i].Asset
	}
	return out, s.attachVariants(ctx, ptrs)
}
