package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type probeResult struct {
	Width      int
	Height     int
	DurationMS int
	Format     string
	HasVideo   bool
}

// probe asks ffprobe what is really inside the file.
func probe(ctx context.Context, path string) (probeResult, error) {
	var out struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
		} `json:"streams"`
		Format struct {
			FormatName string `json:"format_name"`
			Duration   string `json:"duration"`
		} `json:"format"`
	}
	raw, err := run(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file",
		"-print_format", "json", "-show_format", "-show_streams", path)
	if err != nil {
		return probeResult{}, err
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return probeResult{}, err
	}
	res := probeResult{Format: out.Format.FormatName}
	for _, st := range out.Streams {
		if st.CodecType == "video" && st.Width > 0 {
			res.Width, res.Height, res.HasVideo = st.Width, st.Height, true
			break
		}
	}
	if secs, err := strconv.ParseFloat(out.Format.Duration, 64); err == nil && secs > 0 {
		res.DurationMS = int(secs * 1000)
	}
	return res, nil
}

// sniff decides the content type from the file's first bytes, never from the
// name the client sent: a file called cat.png that holds HTML must not be
// served as an image. media reports whether ffmpeg may be pointed at it.
// Only files that start like a known image or video qualify, because ffmpeg
// also "plays" text formats such as playlists, which can name other files.
func sniff(path string) (mime string, media bool) {
	head := make([]byte, 512)
	if f, err := os.Open(path); err == nil {
		n, _ := f.Read(head)
		head = head[:n]
		f.Close()
	}
	mime, _, _ = strings.Cut(http.DetectContentType(head), ";")
	switch {
	case strings.HasPrefix(mime, "image/"), strings.HasPrefix(mime, "video/"):
		return mime, true
	case mime == "application/octet-stream" && len(head) >= 12 && string(head[4:8]) == "ftyp":
		// ISO media containers the standard sniffer does not know.
		switch brand := string(head[8:12]); {
		case brand == "avif" || brand == "avis":
			return "image/avif", true
		case strings.HasPrefix(brand, "qt"):
			return "video/quicktime", true
		default:
			return "video/mp4", true
		}
	}
	return mime, false
}

func kindOf(mime string) string {
	switch {
	case mime == "image/gif":
		return "gif"
	case strings.HasPrefix(mime, "image/"):
		return "image"
	case strings.HasPrefix(mime, "video/"):
		return "video"
	}
	return "file"
}

const thumbFilter = "scale=w='min(512,iw)':h='min(512,ih)':force_original_aspect_ratio=decrease"

// makeThumb writes a WebP still of at most 512 px: the first frame for
// animations and recordings.
func makeThumb(ctx context.Context, in, out string) error {
	_, err := run(ctx, "ffmpeg", append(ffmpegIn(in),
		"-frames:v", "1", "-vf", thumbFilter, "-c:v", "libwebp", "-q:v", "80", out)...)
	return err
}

// ffmpegIn is the shared front of every ffmpeg call. The whitelist keeps a
// crafted file from making ffmpeg open network addresses.
func ffmpegIn(in string, before ...string) []string {
	args := []string{"-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file"}
	return append(append(args, before...), "-i", in)
}

// makeMP4 turns a GIF (or an odd video container) into H.264, which is a
// fraction of the size and plays everywhere.
func makeMP4(ctx context.Context, in, out string) error {
	_, err := run(ctx, "ffmpeg", append(ffmpegIn(in),
		"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-an",
		"-movflags", "+faststart", out)...)
	return err
}

// makeGIF renders a recording as a GIF. A palette is built from the clip
// itself first; GIF has only 256 colours, so a generic palette looks bad.
func makeGIF(ctx context.Context, in, out string, maxSeconds int) error {
	filter := "[0:v]fps=15,scale=w='min(640,iw)':h=-2:flags=lanczos,split[a][b];" +
		"[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
	_, err := run(ctx, "ffmpeg", append(ffmpegIn(in, "-t", strconv.Itoa(maxSeconds)),
		"-filter_complex", filter, "-loop", "0", out)...)
	return err
}

func run(ctx context.Context, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 400 {
			msg = msg[len(msg)-400:]
		}
		return nil, fmt.Errorf("%s: %w: %s", name, err, msg)
	}
	return stdout.Bytes(), nil
}
