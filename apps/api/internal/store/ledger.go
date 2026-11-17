package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// LedgerEntry is one line of the ledger (migration 0012): a change a token
// made, or a note a session left about what it did.
type LedgerEntry struct {
	ID      string    `json:"id"`
	At      time.Time `json:"at"`
	Who     string    `json:"who"`
	Kind    string    `json:"kind"` // "change" or "note"
	Message string    `json:"message"`
	Items   []string  `json:"items"`
}

func (s *Store) AddLedger(ctx context.Context, ownerID, who, kind, message string, items []string, tokenID *string) error {
	if items == nil {
		items = []string{}
	}
	_, err := s.Pool.Exec(ctx,
		`insert into ledger (owner_id, who, kind, message, item_ids, token_id)
		 values ($1, $2, $3, $4, $5::text[]::uuid[], $6)`,
		ownerID, who, kind, message, items, tokenID)
	return err
}

// ListLedger gives the newest lines first. before (an entry id, which grows
// with time: uuidv7) pages back; who narrows it to one writer.
func (s *Store) ListLedger(ctx context.Context, ownerID, before, who string, limit int) ([]LedgerEntry, error) {
	rows, err := s.Pool.Query(ctx,
		`select id::text, at, who, kind, message, item_ids::text[]
		 from ledger
		 where owner_id = $1
		   and ($2 = '' or id < $2::uuid)
		   and ($3 = '' or who = $3)
		 order by id desc
		 limit $4`,
		ownerID, before, who, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (LedgerEntry, error) {
		var e LedgerEntry
		err := r.Scan(&e.ID, &e.At, &e.Who, &e.Kind, &e.Message, &e.Items)
		return e, err
	})
}
