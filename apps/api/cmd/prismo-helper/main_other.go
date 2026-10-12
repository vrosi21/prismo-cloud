//go:build !windows

// Command prismo-helper is Prismo Cloud's desktop helper. It is a Windows
// program (see main_windows.go); elsewhere prismo-watch uploads captures.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "prismo-helper is for Windows. On this system prismo-watch uploads captures.")
	os.Exit(1)
}
