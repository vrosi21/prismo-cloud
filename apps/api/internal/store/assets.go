package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Asset struct {
	ID           string     `json:"id"`
	OwnerID      string     `json:"-"`
	CollectionID *string    `json:"collection_id"`
	BlobSHA      *string    `json:"-"`
	ExpectedSHA  *string    `json:"-"`
	Kind         string     `json:"kind"`
	Status       string     `json:"status"`
	Error        *string    `json:"error"`
	Title        string     `json:"title"`
	Filename     string     `json:"filename"`
	Mime         string     `json:"mime"`
	Bytes        int64      `json:"bytes"`
	Width        *int       `json:"width"`
	Height       *int       `json:"height"`
	DurationMS   *int       `json:"duration_ms"`
	Visibility   string     `json:"visibility"`
	Slug         string     `json:"slug"`
	Source       string     `json:"source"`
	Tags         []string   `json:"tags"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DeletedAt    *time.Time `json:"deleted_at"`
	Variants     []Variant  `json:"-"`
}

type Variant struct {
	AssetID string
	Role    string
	BlobSHA string
	Mime    string
	Bytes   int64
}

func (a *Asset) Variant(role string) *Variant {
	for i := range a.Variants {
		if a.Variants[i].Role == role {
			return &a.Variants[i]
		}
	}
	return nil
}

const assetCols = `a.id::text, a.owner_id::text, a.collection_id::text, a.blob_sha, a.expected_sha,
	a.kind, a.status, a.error, a.title, a.filename, a.mime, a.bytes, a.width, a.height,
	a.duration_ms, a.visibility, a.slug, a.source, a.tags, a.created_at, a.updated_at, a.deleted_at`

func scanAsset(row pgx.Row) (Asset, error) {
	var a Asset
	err := row.Scan(&a.ID, &a.OwnerID, &a.CollectionID, &a.BlobSHA, &a.ExpectedSHA,
		&a.Kind, &a.Status, &a.Error, &a.Title, &a.Filename, &a.Mime, &a.Bytes, &a.Width, &a.Height,
		&a.DurationMS, &a.Visibility, &a.Slug, &a.Source, &a.Tags, &a.CreatedAt, &a.UpdatedAt, &a.DeletedAt)
	if a.Tags == nil {
		a.Tags = []string{}
	}
	return a, notFound(err)
}

type NewAsset struct {
	ID           *string // nil lets the database pick one
	OwnerID      string
	CollectionID *string
	ExpectedSHA  *string
	Kind         string
	Status       string
	Title        string
	Filename     string
	Mime         string
	Bytes        int64
	Visibility   string
	Slug         string
	Source       string
	Tags         []string
}

func CreateAsset(ctx context.Context, db DBTX, n NewAsset) (Asset, error) {
	if n.Tags == nil {
		n.Tags = []string{}
	}
	return scanAsset(db.QueryRow(ctx,
		`insert into assets as a (id, owner_id, collection_id, expected_sha, kind, status, title,
		                          filename, mime, bytes, visibility, slug, source, tags)
		 values (coalesce($14::uuid, uuidv7()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		 returning `+assetCols,
		n.OwnerID, n.CollectionID, n.ExpectedSHA, n.Kind, n.Status, n.Title,
		n.Filename, n.Mime, n.Bytes, n.Visibility, n.Slug, n.Source, n.Tags, n.ID))
}

// GetAsset loads one asset of an owner, with its variants.
func (s *Store) GetAsset(ctx context.Context, ownerID, id string) (Asset, error) {
	a, err := scanAsset(s.Pool.QueryRow(ctx,
		`select `+assetCols+` from assets a where a.owner_id = $1 and a.id = $2`, ownerID, id))
	if err != nil {
		return a, err
	}
	return a, s.attachVariants(ctx, []*Asset{&a})
}

// AssetByID ignores ownership; only the worker uses it.
func (s *Store) AssetByID(ctx context.Context, id string) (Asset, error) {
	return scanAsset(s.Pool.QueryRow(ctx, `select `+assetCols+` from assets a where a.id = $1`, id))
}

func (s *Store) AssetBySlug(ctx context.Context, slug string) (Asset, error) {
	a, err := scanAsset(s.Pool.QueryRow(ctx,
		`select `+assetCols+` from assets a where a.slug = $1 and a.deleted_at is null`, slug))
	if err != nil {
		return a, err
	}
	return a, s.attachVariants(ctx, []*Asset{&a})
}

// AssetByBlob finds a live asset of this owner that already holds this exact
// file. Lookup is per owner on purpose: a global lookup would let one user
// learn whether another user has a given file.
func (s *Store) AssetByBlob(ctx context.Context, ownerID, sha string) (Asset, error) {
	a, err := scanAsset(s.Pool.QueryRow(ctx,
		`select `+assetCols+` from assets a
		 where a.owner_id = $1 and a.blob_sha = $2 and a.deleted_at is null and a.status = 'ready'
		 order by a.id limit 1`, ownerID, sha))
	if err != nil {
		return a, err
	}
	return a, s.attachVariants(ctx, []*Asset{&a})
}

type AssetFilter struct {
	OwnerID      string
	Trashed      bool
	Kind         string
	CollectionID string // uuid, or "none" for assets without a collection
	Tag          string
	Query        string
	Cursor       string // id of the last asset on the previous page
	Limit        int
}

func (s *Store) ListAssets(ctx context.Context, f AssetFilter) ([]Asset, error) {
	conds := []string{"a.owner_id = $1", "a.status <> 'pending'"}
	args := []any{f.OwnerID}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if f.Trashed {
		conds = append(conds, "a.deleted_at is not null")
	} else {
		conds = append(conds, "a.deleted_at is null")
	}
	if f.Kind != "" {
		add("a.kind = $%d", f.Kind)
	}
	if f.CollectionID == "none" {
		conds = append(conds, "a.collection_id is null")
	} else if f.CollectionID != "" {
		add("a.collection_id = $%d", f.CollectionID)
	}
	if f.Tag != "" {
		add("a.tags @> array[$%d]::text[]", f.Tag)
	}
	if f.Query != "" {
		add("(a.title ilike $%[1]d or a.filename ilike $%[1]d)", "%"+escapeLike(f.Query)+"%")
	}
	if f.Cursor != "" {
		add("a.id < $%d", f.Cursor)
	}
	args = append(args, f.Limit)
	sql := `select ` + assetCols + ` from assets a where ` + strings.Join(conds, " and ") +
		fmt.Sprintf(" order by a.id desc limit $%d", len(args))

	rows, err := s.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ptrs := make([]*Asset, len(out))
	for i := range out {
		ptrs[i] = &out[i]
	}
	return out, s.attachVariants(ctx, ptrs)
}

func (s *Store) attachVariants(ctx context.Context, assets []*Asset) error {
	if len(assets) == 0 {
		return nil
	}
	byID := make(map[string]*Asset, len(assets))
	ids := make([]string, len(assets))
	for i, a := range assets {
		ids[i] = a.ID
		byID[a.ID] = a
	}
	rows, err := s.Pool.Query(ctx,
		`select asset_id::text, role, blob_sha, mime, bytes from variants
		 where asset_id = any($1::text[]::uuid[])`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var v Variant
		if err := rows.Scan(&v.AssetID, &v.Role, &v.BlobSHA, &v.Mime, &v.Bytes); err != nil {
			return err
		}
		if a := byID[v.AssetID]; a != nil {
			a.Variants = append(a.Variants, v)
		}
	}
	return rows.Err()
}

type AssetPatch struct {
	Title         *string
	Tags          *[]string
	Visibility    *string
	Kind          *string
	SetCollection bool
	CollectionID  *string
}

func (s *Store) UpdateAsset(ctx context.Context, ownerID, id string, p AssetPatch) (Asset, error) {
	sets := []string{"updated_at = now()"}
	args := []any{ownerID, id}
	set := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if p.Title != nil {
		set("title", *p.Title)
	}
	if p.Tags != nil {
		set("tags", *p.Tags)
	}
	if p.Visibility != nil {
		set("visibility", *p.Visibility)
	}
	if p.Kind != nil {
		set("kind", *p.Kind)
	}
	if p.SetCollection {
		set("collection_id", p.CollectionID)
	}
	a, err := scanAsset(s.Pool.QueryRow(ctx,
		`update assets a set `+strings.Join(sets, ", ")+
			` where a.owner_id = $1 and a.id = $2 returning `+assetCols, args...))
	if err != nil {
		return a, err
	}
	return a, s.attachVariants(ctx, []*Asset{&a})
}

func (s *Store) TrashAssets(ctx context.Context, ownerID string, ids []string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`update assets set deleted_at = now()
		 where owner_id = $1 and id = any($2::text[]::uuid[]) and deleted_at is null`, ownerID, ids)
	return tag.RowsAffected(), err
}

func (s *Store) RestoreAssets(ctx context.Context, ownerID string, ids []string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`update assets set deleted_at = null
		 where owner_id = $1 and id = any($2::text[]::uuid[]) and deleted_at is not null`, ownerID, ids)
	return tag.RowsAffected(), err
}

// PurgeAssets hard-deletes assets that are already in the trash. Their blobs
// are collected later by the worker once nothing references them.
func (s *Store) PurgeAssets(ctx context.Context, ownerID string, ids []string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`delete from assets
		 where owner_id = $1 and id = any($2::text[]::uuid[]) and deleted_at is not null`, ownerID, ids)
	return tag.RowsAffected(), err
}

func (s *Store) SetAssetsCollection(ctx context.Context, ownerID string, ids []string, collectionID *string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`update assets set collection_id = $3, updated_at = now()
		 where owner_id = $1 and id = any($2::text[]::uuid[])`, ownerID, ids, collectionID)
	return tag.RowsAffected(), err
}

func (s *Store) SetAssetsVisibility(ctx context.Context, ownerID string, ids []string, visibility string) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`update assets set visibility = $3, updated_at = now()
		 where owner_id = $1 and id = any($2::text[]::uuid[])`, ownerID, ids, visibility)
	return tag.RowsAffected(), err
}

// MarkUploaded moves a pending asset to processing once its bytes are in the
// staging area. Returns ErrNotFound when the asset is not pending.
func MarkUploaded(ctx context.Context, db DBTX, ownerID, id string, bytes int64) (Asset, error) {
	return scanAsset(db.QueryRow(ctx,
		`update assets a set status = 'processing', bytes = $3, updated_at = now()
		 where a.owner_id = $1 and a.id = $2 and a.status = 'pending' returning `+assetCols,
		ownerID, id, bytes))
}

type Processed struct {
	BlobSHA    string
	Mime       string
	Bytes      int64
	Kind       string
	Width      *int
	Height     *int
	DurationMS *int
}

// FinishAsset records the verified file. A kind chosen by the user (sticker)
// is kept; otherwise the detected kind wins.
func FinishAsset(ctx context.Context, db DBTX, id string, p Processed) error {
	_, err := db.Exec(ctx,
		`update assets set blob_sha = $2, mime = $3, bytes = $4, width = $5, height = $6,
		        duration_ms = $7, kind = case when kind = 'sticker' then kind else $8 end,
		        status = 'ready', error = null, updated_at = now()
		 where id = $1`,
		id, p.BlobSHA, p.Mime, p.Bytes, p.Width, p.Height, p.DurationMS, p.Kind)
	return err
}

func (s *Store) FailAsset(ctx context.Context, id, reason string) error {
	_, err := s.Pool.Exec(ctx,
		`update assets set status = 'failed', error = $2, updated_at = now() where id = $1`, id, reason)
	return err
}

func (s *Store) BlobExists(ctx context.Context, sha string) (bool, error) {
	var ok bool
	err := s.Pool.QueryRow(ctx, `select exists (select 1 from blobs where sha256 = $1)`, sha).Scan(&ok)
	return ok, err
}

func (s *Store) InsertBlob(ctx context.Context, sha string, bytes int64, mime string) error {
	_, err := s.Pool.Exec(ctx,
		`insert into blobs (sha256, bytes, mime) values ($1, $2, $3) on conflict (sha256) do nothing`,
		sha, bytes, mime)
	return err
}

func UpsertVariant(ctx context.Context, db DBTX, v Variant) error {
	_, err := db.Exec(ctx,
		`insert into variants (asset_id, role, blob_sha, mime, bytes) values ($1, $2, $3, $4, $5)
		 on conflict (asset_id, role) do update
		 set blob_sha = excluded.blob_sha, mime = excluded.mime, bytes = excluded.bytes`,
		v.AssetID, v.Role, v.BlobSHA, v.Mime, v.Bytes)
	return err
}

type Stats struct {
	Assets     int64 `json:"assets"`
	Trashed    int64 `json:"trashed"`
	Bytes      int64 `json:"bytes"`
	Processing int64 `json:"processing"`
}

func (s *Store) Stats(ctx context.Context, ownerID string) (Stats, error) {
	var st Stats
	err := s.Pool.QueryRow(ctx,
		`select count(*) filter (where deleted_at is null and status <> 'pending'),
		        count(*) filter (where deleted_at is not null),
		        coalesce(sum(bytes) filter (where status <> 'pending'), 0)::bigint,
		        count(*) filter (where status = 'processing')
		 from assets where owner_id = $1`, ownerID).
		Scan(&st.Assets, &st.Trashed, &st.Bytes, &st.Processing)
	return st, err
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

func (s *Store) Tags(ctx context.Context, ownerID string) ([]TagCount, error) {
	rows, err := s.Pool.Query(ctx,
		`select t, count(*) from assets, unnest(tags) as t
		 where owner_id = $1 and deleted_at is null
		 group by t order by count(*) desc, t limit 200`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TagCount{}
	for rows.Next() {
		var t TagCount
		if err := rows.Scan(&t.Tag, &t.Count); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
