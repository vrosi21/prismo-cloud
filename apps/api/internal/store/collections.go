package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Collection is a folder. Folders nest through ParentID; nil means top level.
type Collection struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  *string   `json:"parent_id"`
	Count     int       `json:"count"` // files directly inside, not in subfolders
	CreatedAt time.Time `json:"created_at"`
}

var (
	ErrCycle   = errors.New("a folder cannot be moved into itself")
	ErrTooDeep = errors.New("folders are nested too deeply")
)

// MaxFolderDepth keeps trees shallow enough that walking up from a file to
// the top stays a handful of rows.
const MaxFolderDepth = 12

// ListCollections returns every folder of an owner as a flat list; ParentID
// is enough for the caller to build the tree.
func (s *Store) ListCollections(ctx context.Context, ownerID string) ([]Collection, error) {
	rows, err := s.Pool.Query(ctx,
		`select c.id::text, c.name, c.parent_id::text, c.created_at,
		        count(a.id) filter (where a.deleted_at is null and a.status <> 'pending')
		 from collections c left join assets a on a.collection_id = c.id
		 where c.owner_id = $1
		 group by c.id order by lower(c.name)`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Collection{}
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.ParentID, &c.CreatedAt, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ChildCollections lists the folders directly inside one folder.
func (s *Store) ChildCollections(ctx context.Context, parentID string) ([]Collection, error) {
	rows, err := s.Pool.Query(ctx,
		`select c.id::text, c.name, c.parent_id::text, c.created_at,
		        (select count(*) from assets a
		         where a.collection_id = c.id and a.deleted_at is null and a.status <> 'pending')
		 from collections c where c.parent_id = $1 order by lower(c.name)`, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Collection{}
	for rows.Next() {
		var c Collection
		if err := rows.Scan(&c.ID, &c.Name, &c.ParentID, &c.CreatedAt, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CreateCollection makes a new folder. A sibling with the same name is a
// unique violation, which the caller reports as "already exists".
func (s *Store) CreateCollection(ctx context.Context, ownerID, name string, parentID *string) (Collection, error) {
	if parentID != nil {
		depth, err := s.depth(ctx, ownerID, *parentID)
		if err != nil {
			return Collection{}, err
		}
		if depth >= MaxFolderDepth {
			return Collection{}, ErrTooDeep
		}
	}
	var c Collection
	err := s.Pool.QueryRow(ctx,
		`insert into collections (owner_id, parent_id, name) values ($1, $2, $3)
		 returning id::text, name, parent_id::text, created_at`,
		ownerID, parentID, name).Scan(&c.ID, &c.Name, &c.ParentID, &c.CreatedAt)
	return c, err
}

// CollectionByPath returns the folder at a path like "screenshots/2026",
// creating whatever part of it is missing. Capture programs name a folder
// instead of knowing its id.
func (s *Store) CollectionByPath(ctx context.Context, ownerID, path string) (Collection, error) {
	var c Collection
	var parent *string
	for _, name := range strings.Split(path, "/") {
		err := s.Pool.QueryRow(ctx,
			`insert into collections (owner_id, parent_id, name) values ($1, $2, $3)
			 on conflict (owner_id, parent_id, lower(name)) do update set name = collections.name
			 returning id::text, name, parent_id::text, created_at`,
			ownerID, parent, name).Scan(&c.ID, &c.Name, &c.ParentID, &c.CreatedAt)
		if err != nil {
			return c, err
		}
		parent = &c.ID
	}
	return c, nil
}

func (s *Store) CollectionExists(ctx context.Context, ownerID, id string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx,
		`select exists (select 1 from collections where owner_id = $1 and id = $2)`,
		ownerID, id).Scan(&ok)
	return ok, err
}

func (s *Store) RenameCollection(ctx context.Context, ownerID, id, name string) error {
	tag, err := s.Pool.Exec(ctx,
		`update collections set name = $3 where owner_id = $1 and id = $2`, ownerID, id, name)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// depth counts the folders from id up to the top, id included. Zero means
// the owner has no such folder.
func (s *Store) depth(ctx context.Context, ownerID, id string) (int, error) {
	var n int
	err := s.Pool.QueryRow(ctx,
		`with recursive up as (
		     select id, parent_id from collections where id = $2 and owner_id = $1
		     union all
		     select c.id, c.parent_id from collections c join up on c.id = up.parent_id)
		 select count(*) from up`, ownerID, id).Scan(&n)
	return n, err
}

// MoveCollection puts a folder under another one, or at the top when
// parentID is nil. Moving a folder into itself or into one of its own
// subfolders would cut the branch off from the tree, so that is refused.
func (s *Store) MoveCollection(ctx context.Context, ownerID, id string, parentID *string) error {
	if parentID != nil {
		var inside bool
		var depth int
		err := s.Pool.QueryRow(ctx,
			`with recursive up as (
			     select id, parent_id from collections where id = $3 and owner_id = $1
			     union all
			     select c.id, c.parent_id from collections c join up on c.id = up.parent_id)
			 select coalesce(bool_or(id = $2), false), count(*) from up`,
			ownerID, id, *parentID).Scan(&inside, &depth)
		switch {
		case err != nil:
			return err
		case depth == 0:
			return ErrNotFound // no such destination
		case inside:
			return ErrCycle
		case depth >= MaxFolderDepth:
			return ErrTooDeep
		}
	}
	tag, err := s.Pool.Exec(ctx,
		`update collections set parent_id = $3 where owner_id = $1 and id = $2`, ownerID, id, parentID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DeleteCollection removes a folder together with its subfolders. What
// happens to the files inside, at any depth, is the caller's choice: they go
// to the trash, or they are kept and move up into the deleted folder's
// parent. Either way no file is destroyed by deleting a folder.
func (s *Store) DeleteCollection(ctx context.Context, ownerID, id string, trashFiles bool) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var parent *string
		err := tx.QueryRow(ctx,
			`select parent_id::text from collections where owner_id = $1 and id = $2 for update`,
			ownerID, id).Scan(&parent)
		if err != nil {
			return notFound(err)
		}
		var ids []string
		err = tx.QueryRow(ctx,
			`with recursive down as (
			     select id from collections where id = $1
			     union all
			     select c.id from collections c join down on c.parent_id = down.id)
			 select array_agg(id::text) from down`, id).Scan(&ids)
		if err != nil {
			return err
		}
		if trashFiles {
			_, err = tx.Exec(ctx,
				`update assets set deleted_at = now()
				 where collection_id = any($1::text[]::uuid[]) and deleted_at is null`, ids)
		} else {
			_, err = tx.Exec(ctx,
				`update assets set collection_id = $2, updated_at = now()
				 where collection_id = any($1::text[]::uuid[])`, ids, parent)
		}
		if err != nil {
			return err
		}
		// One statement for the whole branch: the parent reference is checked
		// when the statement ends, by which time parents and children are
		// gone together.
		_, err = tx.Exec(ctx, `delete from collections where id = any($1::text[]::uuid[])`, ids)
		return err
	})
}
