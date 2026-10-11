package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"

	"prismocloud/internal/blob"
	"prismocloud/internal/store"
)

// processAsset turns a staged upload into a ready asset:
// verify bytes -> store under content hash -> probe -> derive versions.
func (w *Worker) processAsset(ctx context.Context, assetID string) error {
	a, err := w.store.AssetByID(ctx, assetID)
	if errors.Is(err, store.ErrNotFound) {
		return nil // deleted while queued: nothing left to do
	}
	if err != nil {
		return err
	}
	if a.Status == "ready" {
		return nil
	}

	dir, err := os.MkdirTemp("", "prismo-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	src := filepath.Join(dir, "source")
	staging := blob.StagingKey(a.ID)
	if err := w.blob.Download(ctx, staging, src); err != nil {
		return fmt.Errorf("download upload: %w", err)
	}
	sha, size, err := hashFile(src)
	if err != nil {
		return err
	}
	if a.ExpectedSHA != nil && *a.ExpectedSHA != sha {
		// Not worth retrying: the bytes will not change.
		_ = w.blob.Remove(ctx, staging)
		return w.store.FailAsset(ctx, a.ID, "file arrived damaged (checksum mismatch)")
	}

	mime, media := sniff(src)
	out := store.Processed{BlobSHA: sha, Mime: mime, Bytes: size, Kind: kindOf(mime)}
	if err := w.keepBlob(ctx, sha, size, mime, src); err != nil {
		return err
	}

	var variants []store.Variant
	if media {
		if p, err := probe(ctx, src); err != nil {
			slog.Warn("probe failed", "asset", a.ID, "err", err)
		} else if p.HasVideo {
			out.Width, out.Height = &p.Width, &p.Height
			if out.Kind != "image" && p.DurationMS > 0 {
				out.DurationMS = &p.DurationMS
			}
		}
		variants = w.derive(ctx, a.ID, dir, src, out)
	}

	err = pgx.BeginFunc(ctx, w.store.Pool, func(tx pgx.Tx) error {
		if err := store.FinishAsset(ctx, tx, a.ID, out); err != nil {
			return err
		}
		for _, v := range variants {
			if err := store.UpsertVariant(ctx, tx, v); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Only now is the staged copy redundant. Removing it earlier would leave
	// a retry with nothing to work from.
	if err := w.blob.Remove(ctx, staging); err != nil {
		slog.Warn("remove staged upload", "asset", a.ID, "err", err)
	}
	return nil
}

// derive makes the extra versions of a media file. Each one is best effort:
// an asset without a thumbnail is still a usable asset.
func (w *Worker) derive(ctx context.Context, assetID, dir, src string, p store.Processed) []store.Variant {
	type step struct {
		role, mime, file string
		make             func(out string) error
	}
	steps := []step{{"thumb", "image/webp", "thumb.webp", func(out string) error { return makeThumb(ctx, src, out) }}}

	needMP4 := p.Kind == "gif" || (p.Kind == "video" && p.Mime != "video/mp4" && p.Mime != "video/webm")
	if needMP4 {
		steps = append(steps, step{"mp4", "video/mp4", "video.mp4", func(out string) error { return makeMP4(ctx, src, out) }})
	}
	short := p.DurationMS != nil && *p.DurationMS <= w.cfg.GIFMaxSeconds*1000
	if p.Kind == "video" && short {
		steps = append(steps, step{"gif", "image/gif", "anim.gif", func(out string) error {
			return makeGIF(ctx, src, out, w.cfg.GIFMaxSeconds)
		}})
	}

	var variants []store.Variant
	for _, st := range steps {
		out := filepath.Join(dir, st.file)
		if err := st.make(out); err != nil {
			slog.Warn("variant failed", "asset", assetID, "role", st.role, "err", err)
			continue
		}
		sha, size, err := hashFile(out)
		if err != nil || size == 0 {
			continue
		}
		if err := w.keepBlob(ctx, sha, size, st.mime, out); err != nil {
			slog.Warn("store variant failed", "asset", assetID, "role", st.role, "err", err)
			continue
		}
		variants = append(variants, store.Variant{AssetID: assetID, Role: st.role, BlobSHA: sha, Mime: st.mime, Bytes: size})
	}
	return variants
}

// keepBlob stores a file under its hash unless that content is already there.
// The row is written after the object, so a row always implies an object.
func (w *Worker) keepBlob(ctx context.Context, sha string, size int64, mime, path string) error {
	exists, err := w.store.BlobExists(ctx, sha)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	if err := w.blob.PutFile(ctx, blob.Key(sha), path, mime); err != nil {
		return fmt.Errorf("store blob: %w", err)
	}
	return w.store.InsertBlob(ctx, sha, size, mime)
}

func hashFile(path string) (sha string, size int64, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	if size, err = io.Copy(h, f); err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), size, nil
}
