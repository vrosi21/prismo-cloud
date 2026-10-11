package store

import (
	"context"
	"time"
)

type Collection struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Count     int       `json:"count"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) ListCollections(ctx context.Context, ownerID string) ([]Collection, error) {
	rows, err := s.Pool.Query(ctx,
		`select c.id::text, c.name, c.created_at,
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
		if err := rows.Scan(&c.ID, &c.Name, &c.CreatedAt, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CollectionByName returns the owner's collection with that name, creating it
// when missing. Capture clients name a collection instead of knowing its id.
func (s *Store) CollectionByName(ctx context.Context, ownerID, name string) (Collection, error) {
	var c Collection
	err := s.Pool.QueryRow(ctx,
		`insert into collections (owner_id, name) values ($1, $2)
		 on conflict (owner_id, lower(name)) do update set name = collections.name
		 returning id::text, name, created_at`,
		ownerID, name).Scan(&c.ID, &c.Name, &c.CreatedAt)
	return c, err
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

// DeleteCollection removes the collection only; its assets stay, uncollected.
func (s *Store) DeleteCollection(ctx context.Context, ownerID, id string) error {
	tag, err := s.Pool.Exec(ctx, `delete from collections where owner_id = $1 and id = $2`, ownerID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
