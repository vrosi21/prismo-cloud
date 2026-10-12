package worker

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/webp"
)

// Animated WebP is what most sites hand out when a "GIF" is saved from them.
// ffmpeg cannot read it, so it is taken apart here: the file is a list of
// small pictures with a place, a duration and two rules each, and playing it
// means painting them one after the other onto a canvas. What the canvas
// shows at each moment is piped into ffmpeg, which writes a real GIF. That
// GIF is what thumbnails are made from and what gets pasted into chats.

const (
	// Bigger than this is not somebody's reaction GIF.
	webpMaxBytes  = 64 << 20
	webpMaxSide   = 4096
	webpMaxFrames = 1500
)

// A chunk is how the file is built: four letters, a length, that many bytes.
type chunk struct {
	name string
	data []byte
}

// chunks splits a run of chunks. Odd lengths are followed by one filler byte.
func chunks(b []byte) []chunk {
	var out []chunk
	for len(b) >= 8 {
		size := int(binary.LittleEndian.Uint32(b[4:8]))
		if size < 0 || size > len(b)-8 {
			break
		}
		out = append(out, chunk{string(b[0:4]), b[8 : 8+size]})
		b = b[8+size:]
		if size%2 == 1 && len(b) > 0 {
			b = b[1:]
		}
	}
	return out
}

func uint24(b []byte) int { return int(b[0]) | int(b[1])<<8 | int(b[2])<<16 }

// animatedWebP reports whether a file is a WebP that moves. Only the start
// is read: the header says so in one bit.
func animatedWebP(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 30)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	const animation = 0x02
	return string(head[0:4]) == "RIFF" && string(head[8:12]) == "WEBP" && string(head[12:16]) == "VP8X" && head[20]&animation != 0
}

type webpFrame struct {
	at       image.Point
	size     image.Point
	duration time.Duration
	// When this frame has had its time, wipe its rectangle before the next one.
	wipeAfter bool
	// Replace what is underneath instead of painting over it.
	replace bool
	data    []byte // the picture itself, as chunks
}

func readAnimation(raw []byte) (canvas image.Point, frames []webpFrame, err error) {
	if len(raw) < 12 || string(raw[0:4]) != "RIFF" || string(raw[8:12]) != "WEBP" {
		return canvas, nil, errors.New("not a WebP file")
	}
	for _, c := range chunks(raw[12:]) {
		switch {
		case c.name == "VP8X" && len(c.data) >= 10:
			canvas = image.Pt(uint24(c.data[4:])+1, uint24(c.data[7:])+1)
		case c.name == "ANMF" && len(c.data) > 16:
			d := c.data
			f := webpFrame{
				at:        image.Pt(uint24(d[0:])*2, uint24(d[3:])*2),
				size:      image.Pt(uint24(d[6:])+1, uint24(d[9:])+1),
				duration:  time.Duration(uint24(d[12:])) * time.Millisecond,
				wipeAfter: d[15]&0x01 != 0,
				replace:   d[15]&0x02 != 0,
				data:      d[16:],
			}
			// Browsers play "no time at all" as a tenth of a second; so do we.
			if f.duration < 20*time.Millisecond {
				f.duration = 100 * time.Millisecond
			}
			frames = append(frames, f)
		}
	}
	switch {
	case canvas.X <= 0 || canvas.Y <= 0 || canvas.X > webpMaxSide || canvas.Y > webpMaxSide:
		return canvas, nil, fmt.Errorf("canvas of %dx%d is out of range", canvas.X, canvas.Y)
	case len(frames) == 0:
		return canvas, nil, errors.New("no frames in it")
	}
	return canvas, frames, nil
}

// decode turns one frame into a picture. A frame is not a file of its own,
// only the inside of one, so the few bytes that make it a file are put around it.
func (f webpFrame) decode() (image.Image, error) {
	var body bytes.Buffer
	hasAlpha := false
	for _, c := range chunks(f.data) {
		hasAlpha = hasAlpha || c.name == "ALPH"
	}
	if hasAlpha {
		// A separate see-through layer needs the long form of the header.
		header := make([]byte, 10)
		header[0] = 0x10 // "has see-through parts"
		w, h := f.size.X-1, f.size.Y-1
		header[4], header[5], header[6] = byte(w), byte(w>>8), byte(w>>16)
		header[7], header[8], header[9] = byte(h), byte(h>>8), byte(h>>16)
		writeChunk(&body, "VP8X", header)
	}
	for _, c := range chunks(f.data) {
		if c.name == "ALPH" || c.name == "VP8 " || c.name == "VP8L" {
			writeChunk(&body, c.name, c.data)
		}
	}
	var file bytes.Buffer
	file.WriteString("RIFF")
	_ = binary.Write(&file, binary.LittleEndian, uint32(4+body.Len()))
	file.WriteString("WEBP")
	file.Write(body.Bytes())
	return webp.Decode(&file)
}

func writeChunk(w *bytes.Buffer, name string, data []byte) {
	w.WriteString(name)
	_ = binary.Write(w, binary.LittleEndian, uint32(len(data)))
	w.Write(data)
	if len(data)%2 == 1 {
		w.WriteByte(0)
	}
}

// webpToGIF plays an animated WebP into a GIF and reports the size of the
// original, which may be larger than the GIF.
func webpToGIF(ctx context.Context, in, out string) (size image.Point, err error) {
	// The file is whatever somebody uploaded. If decoding it trips over
	// something nobody thought of, that is one file not played, not a worker
	// that falls over.
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("broken file: %v", r)
		}
	}()
	if st, err := os.Stat(in); err != nil || st.Size() > webpMaxBytes {
		return size, errors.New("too big to play")
	}
	raw, err := os.ReadFile(in)
	if err != nil {
		return size, err
	}
	size, frames, err := readAnimation(raw)
	if err != nil {
		return size, err
	}

	// A GIF ticks in hundredths of a second, and every frame of a GIF made
	// from a stream lasts equally long. So time is cut into equal steps as
	// long as the shortest frame, and a longer frame simply takes several.
	step := frames[0].duration
	for _, f := range frames {
		step = min(step, f.duration)
	}
	step = max(20*time.Millisecond, min(step, 100*time.Millisecond)).Round(10 * time.Millisecond)

	canvas := image.NewNRGBA(image.Rectangle{Max: size})
	seeThrough := false
	play := func(w io.Writer) error {
		var wipe image.Rectangle
		written := 0
		for _, f := range frames {
			if err := ctx.Err(); err != nil {
				return err
			}
			draw.Draw(canvas, wipe, image.Transparent, image.Point{}, draw.Src)
			img, err := f.decode()
			if err != nil {
				return fmt.Errorf("frame %d: %w", written, err)
			}
			where := image.Rectangle{Min: f.at, Max: f.at.Add(f.size)}
			op := draw.Over
			if f.replace {
				op = draw.Src
			}
			draw.Draw(canvas, where, img, img.Bounds().Min, op)
			wipe = image.Rectangle{}
			if f.wipeAfter {
				wipe = where
			}
			if !seeThrough {
				for i := 3; i < len(canvas.Pix); i += 4 {
					if canvas.Pix[i] < 128 {
						seeThrough = true
						break
					}
				}
			}
			for n := max(1, int((f.duration+step/2)/step)); n > 0 && written < webpMaxFrames; n-- {
				if _, err := w.Write(canvas.Pix); err != nil {
					return err
				}
				written++
			}
		}
		return nil
	}

	// The frames are needed twice: once to see whether anything is
	// see-through (the GIF's colours are chosen differently then), once to
	// write them. Playing into nothing first answers the question.
	if err := play(io.Discard); err != nil {
		return size, err
	}
	for i := range canvas.Pix {
		canvas.Pix[i] = 0
	}

	// A GIF has 256 colours. They are picked from this very clip, and when
	// parts are see-through one of them is kept for "nothing here".
	palette, use := "palettegen=stats_mode=diff", "paletteuse=dither=bayer:bayer_scale=5"
	if seeThrough {
		palette, use = "palettegen=reserve_transparent=1", "paletteuse=dither=bayer:bayer_scale=5:alpha_threshold=128"
	}
	filter := "[0:v]scale=w='min(640,iw)':h=-1:flags=lanczos,split[a][b];[a]" + palette + "[p];[b][p]" + use
	args := []string{"-hide_banner", "-loglevel", "error", "-y",
		"-f", "rawvideo", "-pix_fmt", "rgba", "-s", strconv.Itoa(size.X) + "x" + strconv.Itoa(size.Y),
		"-framerate", strconv.FormatFloat(float64(time.Second)/float64(step), 'f', 3, 64), "-i", "pipe:0",
		"-filter_complex", filter, "-loop", "0", out}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return size, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return size, err
	}
	playErr := play(stdin)
	stdin.Close()
	if err := cmd.Wait(); err != nil {
		return size, fmt.Errorf("ffmpeg: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return size, playErr
}
