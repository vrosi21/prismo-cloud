package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Calendar is how one category of items shows in the calendar (migration
// 0013). Tag "*" holds the colours by tag that every calendar shares.
type Calendar struct {
	Tag       string         `json:"tag"`
	Name      string         `json:"name"`
	Color     *int           `json:"color"`
	Group     string         `json:"group"`
	TagColors map[string]int `json:"tag_colors"`
	UpdatedAt time.Time      `json:"updated_at"`
}

func (s *Store) ListCalendars(ctx context.Context, ownerID string) ([]Calendar, error) {
	rows, err := s.Pool.Query(ctx,
		`select tag, name, color, grp, tag_colors, updated_at
		 from calendars where owner_id = $1 order by tag`, ownerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Calendar, error) {
		var c Calendar
		err := r.Scan(&c.Tag, &c.Name, &c.Color, &c.Group, &c.TagColors, &c.UpdatedAt)
		return c, err
	})
}

// PutCalendar writes the whole row, made if it is not there yet.
func (s *Store) PutCalendar(ctx context.Context, ownerID string, c Calendar) (Calendar, error) {
	if c.TagColors == nil {
		c.TagColors = map[string]int{}
	}
	err := s.Pool.QueryRow(ctx,
		`insert into calendars (owner_id, tag, name, color, grp, tag_colors)
		 values ($1, $2, $3, $4, $5, $6)
		 on conflict (owner_id, tag) do update
		   set name = excluded.name, color = excluded.color, grp = excluded.grp,
		       tag_colors = excluded.tag_colors, updated_at = now()
		 returning updated_at`,
		ownerID, c.Tag, c.Name, c.Color, c.Group, c.TagColors).Scan(&c.UpdatedAt)
	return c, err
}

// DeleteCalendar drops the settings; the items and their tag stay.
func (s *Store) DeleteCalendar(ctx context.Context, ownerID, tag string) error {
	_, err := s.Pool.Exec(ctx, `delete from calendars where owner_id = $1 and tag = $2`, ownerID, tag)
	return err
}
