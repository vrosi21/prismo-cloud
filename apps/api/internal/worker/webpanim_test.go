package worker

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// The files in testdata were made with ffmpeg: ten frames of its test
// pattern (moving), a red box crossing an empty background (seethrough), and
// a single frame (still).

func TestAnimatedWebPIsToldFromAStill(t *testing.T) {
	for name, want := range map[string]bool{"moving.webp": true, "seethrough.webp": true, "still.webp": false, "nothing-there.webp": false} {
		if got := animatedWebP(filepath.Join("testdata", name)); got != want {
			t.Errorf("animatedWebP(%s) = %v, want %v", name, got, want)
		}
	}
}

func TestReadAnimation(t *testing.T) {
	raw, err := os.ReadFile("testdata/moving.webp")
	if err != nil {
		t.Fatal(err)
	}
	canvas, frames, err := readAnimation(raw)
	if err != nil {
		t.Fatal(err)
	}
	if canvas.X != 64 || canvas.Y != 48 || len(frames) != 10 {
		t.Fatalf("canvas %v with %d frames, want 64x48 with 10", canvas, len(frames))
	}
	for i, f := range frames {
		if f.duration != 100*time.Millisecond {
			t.Errorf("frame %d lasts %v, want 100ms", i, f.duration)
		}
		img, err := f.decode()
		if err != nil {
			t.Fatalf("frame %d: %v", i, err)
		}
		// A frame may be smaller than the canvas, never bigger.
		if b := img.Bounds(); f.at.X+b.Dx() > canvas.X || f.at.Y+b.Dy() > canvas.Y {
			t.Errorf("frame %d of %v at %v does not fit the canvas", i, b.Size(), f.at)
		}
	}
}

func TestSeeThroughFramesStaySeeThrough(t *testing.T) {
	raw, _ := os.ReadFile("testdata/seethrough.webp")
	_, frames, err := readAnimation(raw)
	if err != nil {
		t.Fatal(err)
	}
	img, err := frames[0].decode()
	if err != nil {
		t.Fatal(err)
	}
	clear, solid := false, false
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			_, _, _, a := img.At(x, y).RGBA()
			clear = clear || a == 0
			solid = solid || a == 0xffff
		}
	}
	// The first frame covers the whole canvas: the box and the nothing around it.
	if !clear || !solid {
		t.Errorf("first frame: see-through parts %v, solid parts %v; want both", clear, solid)
	}
}

func TestBrokenFilesAreRefusedNotFatal(t *testing.T) {
	raw, _ := os.ReadFile("testdata/moving.webp")
	dir := t.TempDir()
	// Cut off anywhere, and with the lengths inside it scrambled.
	for _, cut := range []int{0, 11, 20, 40, 300, len(raw) - 7} {
		broken := filepath.Join(dir, "broken.webp")
		data := append([]byte{}, raw[:cut]...)
		if cut > 60 {
			data[50], data[51] = 0xff, 0xff
		}
		if err := os.WriteFile(broken, data, 0o644); err != nil {
			t.Fatal(err)
		}
		// With ffmpeg missing this fails at the very end instead; either
		// way it must come back, with an error or without.
		_, _ = webpToGIF(context.Background(), broken, filepath.Join(dir, "out.gif"))
	}
}

func TestWebPToGIF(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed here")
	}
	out := filepath.Join(t.TempDir(), "out.gif")
	size, err := webpToGIF(context.Background(), "testdata/moving.webp", out)
	if err != nil {
		t.Fatal(err)
	}
	if size.X != 64 || size.Y != 48 {
		t.Errorf("size = %v", size)
	}
	p, err := probe(context.Background(), out)
	if err != nil || p.Width != 64 || p.Height != 48 || p.DurationMS < 900 || p.DurationMS > 1100 {
		t.Errorf("the GIF: %+v, %v; want 64x48 lasting a second", p, err)
	}
}
