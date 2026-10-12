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

	if err := w.examine(ctx, a.ID, dir, src, sha, size); err != nil {
		return err
	}
	// Only now is the staged copy redundant. Removing it earlier would leave
	// a retry with nothing to work from.
	if err := w.blob.Remove(ctx, staging); err != nil {
		slog.Warn("remove staged upload", "asset", a.ID, "err", err)
	}
	return nil
}

// reprocessAsset looks again at a file that is already stored, with whatever
// this version of the worker has learned since. Its bytes do not change;
// what it is taken for, and the versions made from it, may.
func (w *Worker) reprocessAsset(ctx context.Context, assetID string) error {
	a, err := w.store.AssetByID(ctx, assetID)
	if errors.Is(err, store.ErrNotFound) || (err == nil && (a.Status != "ready" || a.BlobSHA == nil)) {
		return nil
	}
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "prismo-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	src := filepath.Join(dir, "source")
	if err := w.blob.Download(ctx, blob.Key(*a.BlobSHA), src); err != nil {
		return fmt.Errorf("download file: %w", err)
	}
	sha, size, err := hashFile(src)
	if err != nil {
		return err
	}
	return w.examine(ctx, a.ID, dir, src, sha, size)
}

// examine works out what a file is, makes its other versions and records
// both. src is the file, already checked; dir is scratch space.
func (w *Worker) examine(ctx context.Context, assetID, dir, src, sha string, size int64) error {
	mime, media := sniff(src)
	out := store.Processed{BlobSHA: sha, Mime: mime, Bytes: size, Kind: kindOf(mime)}
	if err := w.keepBlob(ctx, sha, size, mime, src); err != nil {
		return err
	}

	var variants []store.Variant
	if media {
		// What thumbnails and other versions are made from: the file itself,
		// unless it is a kind of animation ffmpeg cannot read.
		play := src
		if mime == "image/webp" && animatedWebP(src) {
			gif := filepath.Join(dir, "played.gif")
			if full, err := webpToGIF(ctx, src, gif); err != nil {
				slog.Warn("animated webp not played", "asset", assetID, "err", err)
			} else {
				// It moves, so it is a GIF to everyone but its file format.
				out.Kind, play = "gif", gif
				out.Width, out.Height = &full.X, &full.Y
				if v, ok := w.keepVariant(ctx, assetID, "gif", "image/gif", gif); ok {
					variants = append(variants, v)
				}
			}
		}
		if p, err := probe(ctx, play); err != nil {
			slog.Warn("probe failed", "asset", assetID, "err", err)
		} else if p.HasVideo {
			if out.Width == nil {
				out.Width, out.Height = &p.Width, &p.Height
			}
			if out.Kind != "image" && p.DurationMS > 0 {
				out.DurationMS = &p.DurationMS
			}
		}
		variants = append(variants, w.derive(ctx, assetID, dir, play, out)...)
	}

	return pgx.BeginFunc(ctx, w.store.Pool, func(tx pgx.Tx) error {
		if err := store.FinishAsset(ctx, tx, assetID, out); err != nil {
			return err
		}
		for _, v := range variants {
			if err := store.UpsertVariant(ctx, tx, v); err != nil {
				return err
			}
		}
		return nil
	})
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
		if v, ok := w.keepVariant(ctx, assetID, st.role, st.mime, out); ok {
			variants = append(variants, v)
		}
	}
	return variants
}

// keepVariant stores one made version of an asset. Like making it, storing
// it is best effort.
func (w *Worker) keepVariant(ctx context.Context, assetID, role, mime, path string) (store.Variant, bool) {
	sha, size, err := hashFile(path)
	if err != nil || size == 0 {
		return store.Variant{}, false
	}
	if err := w.keepBlob(ctx, sha, size, mime, path); err != nil {
		slog.Warn("store variant failed", "asset", assetID, "role", role, "err", err)
		return store.Variant{}, false
	}
	return store.Variant{AssetID: assetID, Role: role, BlobSHA: sha, Mime: mime, Bytes: size}, true
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
