package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	JobProcessAsset = "process_asset"
	JobsChannel     = "prismo_jobs"
)

type Job struct {
	ID          int64
	Kind        string
	Payload     json.RawMessage
	Attempts    int
	MaxAttempts int
}

type AssetJob struct {
	AssetID string `json:"asset_id"`
}

// Enqueue adds a job and wakes idle workers. Called inside the transaction
// that changes the asset, so job and asset state can never disagree.
func Enqueue(ctx context.Context, db DBTX, kind string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `insert into jobs (kind, payload) values ($1, $2)`, kind, string(body)); err != nil {
		return err
	}
	_, err = db.Exec(ctx, `select pg_notify($1, '')`, JobsChannel)
	return err
}

// Dequeue claims the next runnable job. SKIP LOCKED lets many workers pull
// from the same table without waiting on, or double-taking, each other's rows.
func (s *Store) Dequeue(ctx context.Context) (*Job, error) {
	var j Job
	err := s.Pool.QueryRow(ctx,
		`update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
		 where id = (
		     select id from jobs
		     where status = 'queued' and run_at <= now()
		     order by run_at
		     limit 1
		     for update skip locked)
		 returning id, kind, payload, attempts, max_attempts`).
		Scan(&j.ID, &j.Kind, &j.Payload, &j.Attempts, &j.MaxAttempts)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (s *Store) CompleteJob(ctx context.Context, id int64) error {
	_, err := s.Pool.Exec(ctx, `delete from jobs where id = $1`, id)
	return err
}

// RetryJob puts a failed job back with a growing delay, or marks it failed
// for good when it has used up its attempts. Reports whether it gave up.
func (s *Store) RetryJob(ctx context.Context, j *Job, reason string) (gaveUp bool, err error) {
	if j.Attempts >= j.MaxAttempts {
		_, err = s.Pool.Exec(ctx,
			`update jobs set status = 'failed', last_error = $2, locked_at = null where id = $1`, j.ID, reason)
		return true, err
	}
	delay := time.Duration(j.Attempts*j.Attempts) * 10 * time.Second
	_, err = s.Pool.Exec(ctx,
		`update jobs set status = 'queued', last_error = $2, locked_at = null,
		        run_at = now() + make_interval(secs => $3)
		 where id = $1`, j.ID, reason, delay.Seconds())
	return false, err
}

// RequeueStuckJobs returns jobs whose worker died mid-run to the queue.
func (s *Store) RequeueStuckJobs(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`update jobs set status = 'queued', locked_at = null
		 where status = 'running' and locked_at < now() - make_interval(secs => $1)`,
		olderThan.Seconds())
	return tag.RowsAffected(), err
}

// --- Maintenance ------------------------------------------------------------

// ExpiredTrash hard-deletes assets that sat in the trash past retention.
func (s *Store) ExpiredTrash(ctx context.Context, retention time.Duration) (int64, error) {
	tag, err := s.Pool.Exec(ctx,
		`delete from assets where deleted_at < now() - make_interval(secs => $1)`, retention.Seconds())
	return tag.RowsAffected(), err
}

// StaleUploads removes assets whose upload was started but never finished and
// returns their ids so the caller can delete the staging objects.
func (s *Store) StaleUploads(ctx context.Context, olderThan time.Duration) ([]string, error) {
	rows, err := s.Pool.Query(ctx,
		`delete from assets
		 where status = 'pending' and created_at < now() - make_interval(secs => $1)
		 returning id::text`, olderThan.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// CollectOrphanBlobs deletes blobs nothing points at any more. remove is
// called for each one while its row is still locked: an upload of the same
// content that races with us fails its foreign key check and retries, instead
// of ending up with a row whose object we just deleted.
func (s *Store) CollectOrphanBlobs(ctx context.Context, limit int, remove func(sha string) error) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`select b.sha256 from blobs b
			 where b.created_at < now() - interval '1 hour'
			   and not exists (select 1 from assets a where a.blob_sha = b.sha256)
			   and not exists (select 1 from variants v where v.blob_sha = b.sha256)
			 limit $1
			 for update of b skip locked`, limit)
		if err != nil {
			return err
		}
		shas, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, sha := range shas {
			if err := remove(sha); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `delete from blobs where sha256 = $1`, sha); err != nil {
				return err
			}
			n++
		}
		return nil
	})
	return n, err
}
