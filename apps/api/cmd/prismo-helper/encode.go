package main

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"strings"
	"unicode/utf16"
)

// The pieces of the helper that are plain arithmetic on bytes: what goes onto
// the clipboard, and how a hotkey is spelled. Nothing here talks to Windows,
// so it is tested on any machine.

// dib is a picture the way the clipboard's oldest picture format (CF_DIB)
// wants it: a 40-byte header, then rows of blue-green-red from the bottom up,
// each row padded to a multiple of four bytes.
//
// That format has no see-through. Wherever the picture is, it is laid on
// white here; programs that understand see-through read the PNG that is put
// on the clipboard next to this.
func dib(src image.Image) []byte {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	rgba := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(rgba, rgba.Bounds(), src, b.Min, draw.Src)

	stride := (w*3 + 3) &^ 3
	out := make([]byte, 40+stride*h)
	binary.LittleEndian.PutUint32(out[0:], 40) // size of this header
	binary.LittleEndian.PutUint32(out[4:], uint32(w))
	binary.LittleEndian.PutUint32(out[8:], uint32(h)) // positive: bottom row first
	binary.LittleEndian.PutUint16(out[12:], 1)        // planes
	binary.LittleEndian.PutUint16(out[14:], 24)       // bits per pixel
	binary.LittleEndian.PutUint32(out[20:], uint32(stride*h))

	for y := 0; y < h; y++ {
		from := rgba.Pix[y*rgba.Stride:]
		to := out[40+(h-1-y)*stride:]
		for x := 0; x < w; x++ {
			r, g, bl, a := uint32(from[x*4]), uint32(from[x*4+1]), uint32(from[x*4+2]), uint32(from[x*4+3])
			to[x*3] = byte((bl*a + 255*(255-a) + 127) / 255)
			to[x*3+1] = byte((g*a + 255*(255-a) + 127) / 255)
			to[x*3+2] = byte((r*a + 255*(255-a) + 127) / 255)
		}
	}
	return out
}

// dropFiles is a list of files the way the clipboard wants it for "paste
// these files" (CF_HDROP): a 20-byte header saying where the names start and
// that they are wide characters, then each path ending in a zero, then one
// more zero.
func dropFiles(paths []string) []byte {
	out := make([]byte, 20)
	binary.LittleEndian.PutUint32(out[0:], 20) // names start right after the header
	binary.LittleEndian.PutUint32(out[16:], 1) // wide characters
	for _, p := range paths {
		out = append(out, wide(p)...)
	}
	return append(out, 0, 0)
}

// wide is text as Windows takes it: UTF-16, low byte first, ending in a zero.
func wide(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := make([]byte, 0, len(units)*2+2)
	for _, u := range units {
		out = append(out, byte(u), byte(u>>8))
	}
	return append(out, 0, 0)
}

// Modifier keys, as RegisterHotKey counts them.
const (
	modAlt   = 1
	modCtrl  = 2
	modShift = 4
	modWin   = 8
)

var namedKeys = map[string]uint32{
	"space": 0x20, "tab": 0x09, "enter": 0x0D, "insert": 0x2D, "home": 0x24, "end": 0x23,
	"pageup": 0x21, "pagedown": 0x22, "pause": 0x13, "printscreen": 0x2C,
	",": 0xBC, ".": 0xBE, "-": 0xBD, ";": 0xBA, "/": 0xBF, "`": 0xC0,
}

// parseHotkey reads a spelling like "win+shift+g" or "ctrl+f9".
func parseHotkey(s string) (mods, key uint32, err error) {
	parts := strings.Split(strings.ToLower(strings.ReplaceAll(s, " ", "")), "+")
	for i, part := range parts {
		last := i == len(parts)-1
		switch part {
		case "ctrl", "control":
			mods |= modCtrl
		case "alt":
			mods |= modAlt
		case "shift":
			mods |= modShift
		case "win", "windows", "super":
			mods |= modWin
		default:
			if !last {
				return 0, 0, fmt.Errorf("%q is not a modifier key (ctrl, alt, shift, win)", part)
			}
			key = keyCode(part)
			if key == 0 {
				return 0, 0, fmt.Errorf("%q is not a key this understands", part)
			}
		}
	}
	if key == 0 {
		return 0, 0, fmt.Errorf("%q names no key, only modifiers", s)
	}
	if mods == 0 {
		return 0, 0, fmt.Errorf("%q needs ctrl, alt, shift or win with it, or it would swallow the key everywhere", s)
	}
	return mods, key, nil
}

func keyCode(name string) uint32 {
	if code, ok := namedKeys[name]; ok {
		return code
	}
	if len(name) == 1 {
		c := name[0]
		switch {
		case c >= 'a' && c <= 'z':
			return uint32(c - 'a' + 'A')
		case c >= '0' && c <= '9':
			return uint32(c)
		}
	}
	// f1 to f24
	var n int
	if _, err := fmt.Sscanf(name, "f%d", &n); err == nil && n >= 1 && n <= 24 && name == fmt.Sprintf("f%d", n) {
		return uint32(0x70 + n - 1)
	}
	return 0
}

// safeName turns a file's name in the cloud into one that is fine on disk.
// It is what a chat shows when the file is pasted, so it stays readable.
func safeName(name, ext string) string {
	if strings.HasSuffix(strings.ToLower(name), ext) {
		name = name[:len(name)-len(ext)]
	}
	kept := make([]rune, 0, len(name))
	for _, r := range name {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			r = '_'
		}
		if len(kept) < 80 {
			kept = append(kept, r)
		}
	}
	name = strings.Trim(string(kept), " .")
	if name == "" {
		name = "file"
	}
	return name + ext
}
