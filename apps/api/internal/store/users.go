package store

import (
	"context"
	"time"
)

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
}

type APIToken struct {
	ID                string     `json:"id"`
	OwnerID           string     `json:"-"`
	Name              string     `json:"name"`
	Scope             string     `json:"scope"`
	DefaultVisibility string     `json:"default_visibility"`
	CreatedAt         time.Time  `json:"created_at"`
	LastUsedAt        *time.Time `json:"last_used_at"`
}

// EnsureUser returns the account for an email address, creating it on the
// first sign-in. googleSub is Google's id for the account, nil for the
// development sign-in. created tells the caller to set up a new library.
func (s *Store) EnsureUser(ctx context.Context, email string, googleSub *string) (u User, created bool, err error) {
	// xmax is 0 only on a row this statement inserted, which is how one
	// round trip can both upsert and say which of the two happened.
	err = s.Pool.QueryRow(ctx,
		`insert into users (email, google_sub) values ($1, $2)
		 on conflict (lower(email)) do update
		 set google_sub = coalesce(excluded.google_sub, users.google_sub)
		 returning id::text, email, created_at, (xmax = 0)`,
		email, googleSub).Scan(&u.ID, &u.Email, &u.CreatedAt, &created)
	return u, created, err
}

func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, userID string, expires time.Time) error {
	_, err := s.Pool.Exec(ctx,
		`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)`,
		tokenHash, userID, expires)
	return err
}

func (s *Store) UserBySession(ctx context.Context, tokenHash []byte) (User, error) {
	var u User
	err := s.Pool.QueryRow(ctx,
		`select u.id::text, u.email, u.created_at
		 from sessions s join users u on u.id = s.user_id
		 where s.token_hash = $1 and s.expires_at > now()`,
		tokenHash).Scan(&u.ID, &u.Email, &u.CreatedAt)
	return u, notFound(err)
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.Pool.Exec(ctx, `delete from sessions where token_hash = $1`, tokenHash)
	return err
}

func (s *Store) CreateToken(ctx context.Context, ownerID, name string, tokenHash []byte, scope, visibility string) (APIToken, error) {
	t := APIToken{OwnerID: ownerID}
	err := s.Pool.QueryRow(ctx,
		`insert into api_tokens (owner_id, name, token_hash, scope, default_visibility)
		 values ($1, $2, $3, $4, $5)
		 returning id::text, name, scope, default_visibility, created_at, last_used_at`,
		ownerID, name, tokenHash, scope, visibility).
		Scan(&t.ID, &t.Name, &t.Scope, &t.DefaultVisibility, &t.CreatedAt, &t.LastUsedAt)
	return t, err
}

// UpdateToken changes a token's name or the visibility it gives new files.
// A nil argument leaves that setting as it is.
func (s *Store) UpdateToken(ctx context.Context, ownerID, id string, name, visibility *string) (APIToken, error) {
	t := APIToken{OwnerID: ownerID}
	err := s.Pool.QueryRow(ctx,
		`update api_tokens
		 set name = coalesce($3, name), default_visibility = coalesce($4, default_visibility)
		 where owner_id = $1 and id = $2
		 returning id::text, name, scope, default_visibility, created_at, last_used_at`,
		ownerID, id, name, visibility).
		Scan(&t.ID, &t.Name, &t.Scope, &t.DefaultVisibility, &t.CreatedAt, &t.LastUsedAt)
	return t, notFound(err)
}

func (s *Store) ListTokens(ctx context.Context, ownerID string) ([]APIToken, error) {
	rows, err := s.Pool.Query(ctx,
		`select id::text, name, scope, default_visibility, created_at, last_used_at
		 from api_tokens where owner_id = $1 order by id desc`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		t := APIToken{OwnerID: ownerID}
		if err := rows.Scan(&t.ID, &t.Name, &t.Scope, &t.DefaultVisibility, &t.CreatedAt, &t.LastUsedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) DeleteToken(ctx context.Context, ownerID, id string) error {
	tag, err := s.Pool.Exec(ctx, `delete from api_tokens where owner_id = $1 and id = $2`, ownerID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// TokenByHash resolves a bearer token. last_used_at is refreshed at most once
// a minute so a burst of uploads does not turn into a burst of row updates.
func (s *Store) TokenByHash(ctx context.Context, tokenHash []byte) (APIToken, error) {
	var t APIToken
	err := s.Pool.QueryRow(ctx,
		`select id::text, owner_id::text, name, scope, default_visibility, created_at, last_used_at
		 from api_tokens where token_hash = $1`, tokenHash).
		Scan(&t.ID, &t.OwnerID, &t.Name, &t.Scope, &t.DefaultVisibility, &t.CreatedAt, &t.LastUsedAt)
	if err != nil {
		return t, notFound(err)
	}
	if t.LastUsedAt == nil || time.Since(*t.LastUsedAt) > time.Minute {
		_, _ = s.Pool.Exec(ctx, `update api_tokens set last_used_at = now() where id = $1`, t.ID)
	}
	return t, nil
}
