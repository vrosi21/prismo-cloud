package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"testing"
)

func TestDIB(t *testing.T) {
	// 3 wide: a row is 9 bytes of colour, padded to 12.
	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	img.SetNRGBA(0, 0, color.NRGBA{R: 10, G: 20, B: 30, A: 255}) // top left, solid
	img.SetNRGBA(2, 1, color.NRGBA{R: 200, G: 0, B: 0, A: 128})  // bottom right, half see-through
	// everything else stays fully see-through

	out := dib(img)
	if len(out) != 40+12*2 {
		t.Fatalf("length = %d, want %d", len(out), 40+12*2)
	}
	if got := binary.LittleEndian.Uint32(out[0:]); got != 40 {
		t.Errorf("header size = %d", got)
	}
	if w, h := binary.LittleEndian.Uint32(out[4:]), binary.LittleEndian.Uint32(out[8:]); w != 3 || h != 2 {
		t.Errorf("size = %dx%d", w, h)
	}
	if bits := binary.LittleEndian.Uint16(out[14:]); bits != 24 {
		t.Errorf("bits = %d", bits)
	}

	// The bottom row comes first.
	bottom, top := out[40:52], out[52:64]
	if !bytes.Equal(top[0:3], []byte{30, 20, 10}) {
		t.Errorf("top left = %v, want blue-green-red 30 20 10", top[0:3])
	}
	if !bytes.Equal(top[3:6], []byte{255, 255, 255}) {
		t.Errorf("see-through pixel = %v, want white", top[3:6])
	}
	// Half red over white: red stays strong, green and blue come up halfway.
	if got := bottom[6:9]; got[2] < 225 || got[2] > 230 || got[0] < 125 || got[0] > 129 || got[1] != got[0] {
		t.Errorf("half see-through red = %v", got)
	}
}

func TestDIBKeepsOffsetPictures(t *testing.T) {
	// A picture cut out of a bigger one does not start at 0,0.
	big := image.NewNRGBA(image.Rect(0, 0, 10, 10))
	big.SetNRGBA(5, 5, color.NRGBA{R: 1, G: 2, B: 3, A: 255})
	out := dib(big.SubImage(image.Rect(5, 5, 6, 6)))
	if !bytes.Equal(out[40:43], []byte{3, 2, 1}) {
		t.Errorf("pixel = %v, want 3 2 1", out[40:43])
	}
}

func TestDropFiles(t *testing.T) {
	out := dropFiles([]string{`C:\a.gif`, `D:\ž.png`})
	if binary.LittleEndian.Uint32(out[0:]) != 20 || binary.LittleEndian.Uint32(out[16:]) != 1 {
		t.Fatalf("header = %v", out[:20])
	}
	want := append(wide(`C:\a.gif`), wide(`D:\ž.png`)...)
	want = append(want, 0, 0)
	if !bytes.Equal(out[20:], want) {
		t.Errorf("names = %v, want %v", out[20:], want)
	}
	// "ž" is one wide character: 0x017E, low byte first.
	if !bytes.Contains(out, []byte{0x7E, 0x01}) {
		t.Error("non-ASCII name was not written as UTF-16")
	}
}

func TestParseHotkey(t *testing.T) {
	good := []struct {
		in        string
		mods, key uint32
	}{
		{"win+shift+g", modWin | modShift, 'G'},
		{"Ctrl + Alt + Space", modCtrl | modAlt, 0x20},
		{"ctrl+f9", modCtrl, 0x78},
		{"alt+shift+f12", modAlt | modShift, 0x7B},
		{"win+.", modWin, 0xBE},
		{"ctrl+shift+7", modCtrl | modShift, '7'},
	}
	for _, c := range good {
		mods, key, err := parseHotkey(c.in)
		if err != nil || mods != c.mods || key != c.key {
			t.Errorf("parseHotkey(%q) = %d, %#x, %v; want %d, %#x", c.in, mods, key, err, c.mods, c.key)
		}
	}
	for _, bad := range []string{"", "g", "ctrl+shift", "ctrl+banana", "g+ctrl", "ctrl+f25", "ctrl+f09"} {
		if _, _, err := parseHotkey(bad); err == nil {
			t.Errorf("parseHotkey(%q) should fail", bad)
		}
	}
}

func TestSafeName(t *testing.T) {
	cases := [][3]string{
		{"cat.png", ".png", "cat.png"},
		{"Cat.PNG", ".png", "Cat.png"},
		{`a/b\c:d*e?.gif`, ".gif", "a_b_c_d_e_.gif"},
		{"čaj š.png", ".png", "čaj š.png"},
		{"...", ".gif", "file.gif"},
		{"", ".png", "file.png"},
		{"recording.mp4", ".gif", "recording.mp4.gif"},
	}
	for _, c := range cases {
		if got := safeName(c[0], c[1]); got != c[2] {
			t.Errorf("safeName(%q, %q) = %q, want %q", c[0], c[1], got, c[2])
		}
	}
	long := safeName(string(bytes.Repeat([]byte("ž"), 200)), ".png")
	if n := len([]rune(long)); n != 84 {
		t.Errorf("long name is %d characters, want 84", n)
	}
}
