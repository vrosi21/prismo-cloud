// Package worker runs background jobs: verifying uploads, making thumbnails
// and GIF/MP4 versions, and cleaning up storage.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"prismocloud/internal/blob"
	"prismocloud/internal/config"
	"prismocloud/internal/store"
)

type Worker struct {
	cfg   config.Config
	store *store.Store
	blob  *blob.Client
	wake  chan struct{}
}

func New(cfg config.Config, st *store.Store, bl *blob.Client) *Worker {
	return &Worker{cfg: cfg, store: st, blob: bl, wake: make(chan struct{}, cfg.WorkerConcurrency)}
}

// Run blocks until ctx is cancelled. Any number of worker processes can run
// against the same database; each job is claimed by exactly one of them.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < w.cfg.WorkerConcurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.loop(ctx)
		}()
	}
	wg.Add(2)
	go func() { defer wg.Done(); w.listen(ctx) }()
	go func() { defer wg.Done(); w.maintain(ctx) }()
	slog.Info("worker started", "concurrency", w.cfg.WorkerConcurrency)
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context) {
	for ctx.Err() == nil {
		job, err := w.store.Dequeue(ctx)
		if err != nil {
			if ctx.Err() == nil {
				slog.Error("dequeue failed", "err", err)
			}
			sleep(ctx, 2*time.Second)
			continue
		}
		if job == nil {
			// Sleep until a NOTIFY arrives; the timer covers a missed one
			// and jobs scheduled for later (retries).
			select {
			case <-ctx.Done():
			case <-w.wake:
			case <-time.After(5 * time.Second):
			}
			continue
		}
		w.handle(ctx, job)
	}
}

func (w *Worker) handle(ctx context.Context, job *store.Job) {
	start := time.Now()
	err := w.dispatch(ctx, job)
	// Bookkeeping must finish even while shutting down.
	bg := context.WithoutCancel(ctx)
	if err == nil {
		if err := w.store.CompleteJob(bg, job.ID); err != nil {
			slog.Error("complete job failed", "job", job.ID, "err", err)
		}
		slog.Info("job done", "job", job.ID, "kind", job.Kind, "ms", time.Since(start).Milliseconds())
		return
	}
	slog.Warn("job failed", "job", job.ID, "kind", job.Kind, "attempt", job.Attempts, "err", err)
	gaveUp, rerr := w.store.RetryJob(bg, job, err.Error())
	if rerr != nil {
		slog.Error("retry job failed", "job", job.ID, "err", rerr)
	}
	if gaveUp && job.Kind == store.JobProcessAsset {
		var p store.AssetJob
		if json.Unmarshal(job.Payload, &p) == nil {
			_ = w.store.FailAsset(bg, p.AssetID, "could not process this file")
			_ = w.blob.Remove(bg, blob.StagingKey(p.AssetID))
		}
	}
}

func (w *Worker) dispatch(ctx context.Context, job *store.Job) error {
	switch job.Kind {
	case store.JobProcessAsset:
		var p store.AssetJob
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return err
		}
		return w.processAsset(ctx, p.AssetID)
	case store.JobReprocessAsset:
		var p store.AssetJob
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return err
		}
		return w.reprocessAsset(ctx, p.AssetID)
	}
	return fmt.Errorf("unknown job kind %q", job.Kind)
}

// listen holds one connection on LISTEN and nudges idle loops when a job is
// queued, so new uploads start processing at once instead of on the next poll.
func (w *Worker) listen(ctx context.Context) {
	for ctx.Err() == nil {
		if err := w.listenOnce(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("job listener reconnecting", "err", err)
		}
		sleep(ctx, 2*time.Second)
	}
}

func (w *Worker) listenOnce(ctx context.Context) error {
	pooled, err := w.store.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	// Taken out of the pool for good: a connection with LISTEN active must
	// not be handed to ordinary queries.
	conn := pooled.Hijack()
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "listen "+store.JobsChannel); err != nil {
		return err
	}
	for {
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		for i := 0; i < cap(w.wake); i++ {
			select {
			case w.wake <- struct{}{}:
			default:
			}
		}
	}
}

// maintain runs the periodic chores. They are idempotent, so several worker
// processes doing them at once is wasteful but harmless.
func (w *Worker) maintain(ctx context.Context) {
	sleep(ctx, 30*time.Second)
	for ctx.Err() == nil {
		w.maintainOnce(ctx)
		sleep(ctx, 15*time.Minute)
	}
}

func (w *Worker) maintainOnce(ctx context.Context) {
	if n, err := w.store.RequeueStuckJobs(ctx, 20*time.Minute); err != nil {
		slog.Error("requeue stuck jobs", "err", err)
	} else if n > 0 {
		slog.Info("requeued stuck jobs", "count", n)
	}

	if n, err := w.store.ExpiredTrash(ctx, w.cfg.TrashRetention); err != nil {
		slog.Error("empty expired trash", "err", err)
	} else if n > 0 {
		slog.Info("emptied expired trash", "assets", n)
	}

	ids, err := w.store.StaleUploads(ctx, 24*time.Hour)
	if err != nil {
		slog.Error("remove stale uploads", "err", err)
	}
	for _, id := range ids {
		_ = w.blob.Remove(ctx, blob.StagingKey(id))
	}

	for ctx.Err() == nil {
		n, err := w.store.CollectOrphanBlobs(ctx, 200, func(sha string) error {
			return w.blob.Remove(ctx, blob.Key(sha))
		})
		if err != nil {
			slog.Error("collect orphan blobs", "err", err)
			return
		}
		if n == 0 {
			return
		}
		slog.Info("removed unreferenced blobs", "count", n)
	}
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
