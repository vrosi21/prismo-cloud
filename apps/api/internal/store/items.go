package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Item is anything a person writes or plans: a task, an event, a notebook, a
// board. See migration 0009 for how the parts fit together.
type Item struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Title string `json:"title"`
	// Excerpt is the start of the body, for cards and lists. Body and Canvas
	// are only filled when a single item is read.
	Excerpt      string          `json:"excerpt"`
	Body         *string         `json:"body,omitempty"`
	Canvas       json.RawMessage `json:"canvas,omitempty"`
	CollectionID *string         `json:"collection_id"`
	Status       *string         `json:"status"`
	DoneAt       *time.Time      `json:"done_at"`
	Date         *string         `json:"date"`     // 2006-01-02
	Time         *string         `json:"time"`     // 15:04
	EndDate      *string         `json:"end_date"` // last day of a multi-day item
	Minutes      *int            `json:"minutes"`  // length of a timed item
	Repeat       *string         `json:"repeat"`
	RepeatUntil  *string         `json:"repeat_until"` // last day a repeat may fall on
	Color        *int            `json:"color"`
	// Categories: "dsai" is one, "course:mai3" a facet inside it.
	Tags      []string   `json:"tags"`
	Version   int        `json:"version"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at"`
	// Items this one links to and items that link to it, only on a single read.
	Links *[]ItemRef `json:"links,omitempty"`
}

// ItemRef names another item, enough to show it as a link.
type ItemRef struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Title  string  `json:"title"`
	Status *string `json:"status"`
	// "to": this item links to it; "from": it links to this item.
	Dir string `json:"dir"`
}

// ItemFields are the parts of an item that a change can touch.
type ItemFields struct {
	Kind, Title, Body string
	Canvas            []byte // nil unless a board
	CollectionID      *string
	Status            *string
	DoneAt            *time.Time
	Date, Time        *string
	EndDate           *string
	Minutes           *int
	Repeat            *string
	RepeatUntil       *string
	Color             *int
	Tags              []string
	Trashed           bool
}

// ErrConflict: the body or canvas was changed elsewhere since the caller read it.
var ErrConflict = errors.New("changed elsewhere")

const itemCols = `i.id::text, i.kind, i.title, left(i.body, 280), i.collection_id::text, i.status, i.done_at,
	to_char(i.due_date, 'YYYY-MM-DD'), to_char(i.due_time, 'HH24:MI'), to_char(i.end_date, 'YYYY-MM-DD'),
	i.minutes, i.repeat, to_char(i.repeat_until, 'YYYY-MM-DD'), i.color, i.tags,
	i.version, i.created_at, i.updated_at, i.deleted_at`

func scanItem(row pgx.Row, extra ...any) (Item, error) {
	var it Item
	var color *int16
	dest := append([]any{&it.ID, &it.Kind, &it.Title, &it.Excerpt, &it.CollectionID, &it.Status, &it.DoneAt,
		&it.Date, &it.Time, &it.EndDate, &it.Minutes, &it.Repeat, &it.RepeatUntil, &color, &it.Tags, &it.Version,
		&it.CreatedAt, &it.UpdatedAt, &it.DeletedAt}, extra...)
	err := row.Scan(dest...)
	if color != nil {
		c := int(*color)
		it.Color = &c
	}
	return it, err
}

// ItemQuery picks items for a list.
type ItemQuery struct {
	OwnerID string
	// From and To (both included) ask for the calendar: dated items that
	// touch those days, and repeating ones that started before To.
	From, To string
	// Someday adds the tasks with no day that are open or were done in the
	// last two weeks: ticked ones stay in sight for a while.
	Someday      bool
	Kinds        []string
	CollectionID string // a folder id, "none" for the top level, "" for anywhere
	Query        string
	IDs          []string
	Trashed      bool
	Limit        int
}

func (s *Store) ListItems(ctx context.Context, q ItemQuery) ([]Item, error) {
	conds := []string{"i.owner_id = $1"}
	args := []any{q.OwnerID}
	add := func(cond string, v ...any) {
		n := make([]any, len(v))
		for k := range v {
			args = append(args, v[k])
			n[k] = len(args)
		}
		conds = append(conds, fmt.Sprintf(cond, n...))
	}
	if q.Trashed {
		conds = append(conds, "i.deleted_at is not null")
	} else {
		conds = append(conds, "i.deleted_at is null")
	}
	order := "i.updated_at desc, i.id desc"
	if q.From != "" {
		args = append(args, q.From, q.To)
		f, t := len(args)-1, len(args)
		when := fmt.Sprintf(`(i.due_date <= $%[2]d::date and coalesce(i.end_date, i.due_date) >= $%[1]d::date)
			or (i.repeat is not null and i.due_date <= $%[2]d::date)`, f, t)
		if q.Someday {
			when += ` or (i.kind = 'task' and i.due_date is null
				and (i.done_at is null or i.done_at > now() - interval '14 days'))`
		}
		conds = append(conds, "("+when+")")
		order = "i.due_date nulls last, i.due_time nulls first, i.created_at"
	}
	if len(q.Kinds) > 0 {
		add("i.kind = any($%d)", q.Kinds)
	}
	if q.CollectionID == "none" {
		conds = append(conds, "i.collection_id is null")
	} else if q.CollectionID != "" {
		add("i.collection_id = $%d", q.CollectionID)
	}
	if q.Query != "" {
		add("(i.title ilike $%[1]d or i.body ilike $%[1]d)", "%"+escapeLike(q.Query)+"%")
	}
	if len(q.IDs) > 0 {
		add("i.id = any($%d::text[]::uuid[])", q.IDs)
	}
	args = append(args, q.Limit)
	rows, err := s.Pool.Query(ctx, `select `+itemCols+` from items i where `+strings.Join(conds, " and ")+
		fmt.Sprintf(" order by %s limit $%d", order, len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetItem reads one item in full: body, canvas and links.
func (s *Store) GetItem(ctx context.Context, ownerID, id string) (Item, error) {
	var body string
	var canvas []byte
	it, err := scanItem(s.Pool.QueryRow(ctx,
		`select `+itemCols+`, i.body, i.canvas from items i where i.owner_id = $1 and i.id = $2`, ownerID, id),
		&body, &canvas)
	if err != nil {
		return it, notFound(err)
	}
	it.Body, it.Canvas = &body, canvas
	rows, err := s.Pool.Query(ctx,
		`select o.id::text, o.kind, o.title, o.status, l.dir
		 from (select to_id as other, 'to' as dir, created_at from item_links where from_id = $1
		       union all
		       select from_id, 'from', created_at from item_links where to_id = $1) l
		 join items o on o.id = l.other and o.deleted_at is null
		 order by l.created_at`, id)
	if err != nil {
		return it, err
	}
	links, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (ItemRef, error) {
		var ref ItemRef
		err := r.Scan(&ref.ID, &ref.Kind, &ref.Title, &ref.Status, &ref.Dir)
		return ref, err
	})
	it.Links = &links
	return it, err
}

func (s *Store) CreateItem(ctx context.Context, ownerID string, f ItemFields) (Item, error) {
	var id string
	err := s.Pool.QueryRow(ctx,
		`insert into items (owner_id, kind, title, body, canvas, collection_id, status, done_at,
		                    due_date, due_time, end_date, minutes, repeat, repeat_until, color, tags)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		 returning id::text`,
		ownerID, f.Kind, f.Title, f.Body, nullJSON(f.Canvas), f.CollectionID, f.Status, f.DoneAt,
		f.Date, f.Time, f.EndDate, f.Minutes, f.Repeat, f.RepeatUntil, f.Color, tagsOrEmpty(f.Tags)).Scan(&id)
	if err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, ownerID, id)
}

// UpdateItem changes an item under a row lock: change gets the fields as they
// are and edits them in place. version, when not 0, must be the version the
// caller read, but only matters if the body or the canvas changes: renaming
// or moving a notebook does not upset an editor that has it open.
func (s *Store) UpdateItem(ctx context.Context, ownerID, id string, version int, change func(*ItemFields) error) (Item, error) {
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		var f ItemFields
		var cur int
		var deleted *time.Time
		var color *int16
		err := tx.QueryRow(ctx,
			`select kind, title, body, canvas, collection_id::text, status, done_at,
			        to_char(due_date, 'YYYY-MM-DD'), to_char(due_time, 'HH24:MI'), to_char(end_date, 'YYYY-MM-DD'),
			        minutes, repeat, to_char(repeat_until, 'YYYY-MM-DD'), color, tags, version, deleted_at
			 from items where owner_id = $1 and id = $2 for update`, ownerID, id).
			Scan(&f.Kind, &f.Title, &f.Body, &f.Canvas, &f.CollectionID, &f.Status, &f.DoneAt,
				&f.Date, &f.Time, &f.EndDate, &f.Minutes, &f.Repeat, &f.RepeatUntil, &color, &f.Tags, &cur, &deleted)
		if err != nil {
			return notFound(err)
		}
		if color != nil {
			c := int(*color)
			f.Color = &c
		}
		f.Trashed = deleted != nil
		body, canvas := f.Body, string(f.Canvas)
		if err := change(&f); err != nil {
			return err
		}
		content := f.Body != body || string(f.Canvas) != canvas
		if content && version != 0 && version != cur {
			return ErrConflict
		}
		_, err = tx.Exec(ctx,
			`update items set kind = $3, title = $4, body = $5, canvas = $6, collection_id = $7,
			        status = $8, done_at = $9, due_date = $10, due_time = $11, end_date = $12,
			        minutes = $13, repeat = $14, repeat_until = $15, color = $16, tags = $17,
			        deleted_at = case when $18 then coalesce(deleted_at, now()) end,
			        version = version + $19, updated_at = now()
			 where owner_id = $1 and id = $2`,
			ownerID, id, f.Kind, f.Title, f.Body, nullJSON(f.Canvas), f.CollectionID,
			f.Status, f.DoneAt, f.Date, f.Time, f.EndDate, f.Minutes, f.Repeat, f.RepeatUntil, f.Color,
			tagsOrEmpty(f.Tags), f.Trashed, boolInt(content))
		return err
	})
	if err != nil {
		return Item{}, err
	}
	return s.GetItem(ctx, ownerID, id)
}

// DeleteItem removes an item for good. Only one already in the trash.
func (s *Store) DeleteItem(ctx context.Context, ownerID, id string) error {
	tag, err := s.Pool.Exec(ctx,
		`delete from items where owner_id = $1 and id = $2 and deleted_at is not null`, ownerID, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// LinkItems links from one item to another; both must be the owner's.
func (s *Store) LinkItems(ctx context.Context, ownerID, from, to string) error {
	tag, err := s.Pool.Exec(ctx,
		`insert into item_links (from_id, to_id)
		 select a.id, b.id from items a, items b
		 where a.id = $2 and b.id = $3 and a.owner_id = $1 and b.owner_id = $1
		 on conflict do nothing`, ownerID, from, to)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either already linked (fine) or one of them is not the owner's.
		var n int
		if err := s.Pool.QueryRow(ctx,
			`select count(*) from items where owner_id = $1 and id in ($2, $3)`, ownerID, from, to).Scan(&n); err != nil {
			return err
		}
		if n < 2 {
			return ErrNotFound
		}
	}
	return nil
}

// UnlinkItems removes a link, whichever way it points.
func (s *Store) UnlinkItems(ctx context.Context, ownerID, a, b string) error {
	tag, err := s.Pool.Exec(ctx,
		`delete from item_links l using items i
		 where i.id = l.from_id and i.owner_id = $1
		   and ((l.from_id = $2 and l.to_id = $3) or (l.from_id = $3 and l.to_id = $2))`, ownerID, a, b)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func tagsOrEmpty(t []string) []string {
	if t == nil {
		return []string{}
	}
	return t
}

func nullJSON(b []byte) any {
	if b == nil {
		return nil
	}
	return string(b)
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
