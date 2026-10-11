// Package blob wraps the S3 API. Nothing outside it knows which object store
// is behind the endpoint, so Garage can be swapped for any S3-compatible one.
package blob

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/cors"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"prismocloud/internal/config"
)

type Client struct {
	bucket string
	inner  *minio.Client // talks to storage from inside the stack
	public *minio.Client // only signs URLs for the address browsers use
}

func New(cfg config.S3) (*Client, error) {
	inner, err := newClient(cfg.Endpoint, cfg)
	if err != nil {
		return nil, err
	}
	public, err := newClient(cfg.PublicEndpoint, cfg)
	if err != nil {
		return nil, err
	}
	return &Client{bucket: cfg.Bucket, inner: inner, public: public}, nil
}

func newClient(endpoint string, cfg config.S3) (*minio.Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	return minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https",
		// A fixed region means signing needs no lookup request first.
		Region:       cfg.Region,
		BucketLookup: minio.BucketLookupPath,
	})
}

// StagingKey is where an upload lands before its content is verified.
func StagingKey(assetID string) string { return "uploads/" + assetID }

// Key is the permanent, content-addressed location of a verified file.
func Key(sha string) string { return "blobs/" + sha[:2] + "/" + sha }

// EnsureCORS lets browsers on the given origins PUT straight to the bucket.
func (c *Client) EnsureCORS(ctx context.Context, origins []string) error {
	return c.inner.SetBucketCors(ctx, c.bucket, &cors.Config{
		CORSRules: []cors.Rule{{
			AllowedOrigin: origins,
			AllowedMethod: []string{"PUT", "GET", "HEAD"},
			AllowedHeader: []string{"*"},
			ExposeHeader:  []string{"ETag"},
			MaxAgeSeconds: 3600,
		}},
	})
}

func (c *Client) PresignPut(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := c.public.PresignedPutObject(ctx, c.bucket, key, ttl)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// Put streams a body of unknown length. PartSize is set explicitly: left at
// zero the client sizes its buffer for a 5 TiB object, about half a gigabyte.
func (c *Client) Put(ctx context.Context, key string, r io.Reader, contentType string) (int64, error) {
	info, err := c.inner.PutObject(ctx, c.bucket, key, r, -1, minio.PutObjectOptions{
		ContentType: contentType,
		PartSize:    16 << 20,
	})
	return info.Size, err
}

func (c *Client) PutFile(ctx context.Context, key, path, contentType string) error {
	_, err := c.inner.FPutObject(ctx, c.bucket, key, path, minio.PutObjectOptions{ContentType: contentType})
	return err
}

func (c *Client) Download(ctx context.Context, key, path string) error {
	return c.inner.FGetObject(ctx, c.bucket, key, path, minio.GetObjectOptions{})
}

// Open returns a seekable reader, which is what http.ServeContent needs to
// answer Range requests.
func (c *Client) Open(ctx context.Context, key string) (*minio.Object, time.Time, error) {
	obj, err := c.inner.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, time.Time{}, err
	}
	st, err := obj.Stat()
	if err != nil {
		obj.Close()
		return nil, time.Time{}, err
	}
	return obj, st.LastModified, nil
}

// Size reports the size of an object, or -1 when it does not exist.
func (c *Client) Size(ctx context.Context, key string) (int64, error) {
	st, err := c.inner.StatObject(ctx, c.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if IsNotFound(err) {
			return -1, nil
		}
		return 0, err
	}
	return st.Size, nil
}

func (c *Client) Remove(ctx context.Context, key string) error {
	return c.inner.RemoveObject(ctx, c.bucket, key, minio.RemoveObjectOptions{})
}

func (c *Client) Ready(ctx context.Context) error {
	ok, err := c.inner.BucketExists(ctx, c.bucket)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("bucket %q does not exist", c.bucket)
	}
	return nil
}

func IsNotFound(err error) bool {
	code := minio.ToErrorResponse(err).Code
	return code == "NoSuchKey" || code == "NotFound"
}
