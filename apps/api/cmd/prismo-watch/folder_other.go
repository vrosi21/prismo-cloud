//go:build !windows

package main

func screenshotsDir() string { return guessDir() }
