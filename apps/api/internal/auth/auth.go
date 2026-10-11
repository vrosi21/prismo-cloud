// Package auth generates the random secrets and ids the app hands out.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"math/big"
	"time"
)

const (
	TokenPrefix = "prismo_"
	alphabet    = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
)

// RandomString returns n characters of base62 from the system CSPRNG.
func RandomString(n int) string {
	out := make([]byte, n)
	max := big.NewInt(int64(len(alphabet)))
	for i := range out {
		v, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err) // no entropy source: nothing sensible left to do
		}
		out[i] = alphabet[v.Int64()]
	}
	return string(out)
}

func NewSlug() string { return RandomString(10) }

// NewUUIDv7 returns a time-ordered uuid: 48 bits of Unix milliseconds, then
// random bits. Used when an id is needed before the row exists.
func NewUUIDv7() string {
	var b [16]byte
	ms := uint64(time.Now().UnixMilli())
	b[0], b[1], b[2] = byte(ms>>40), byte(ms>>32), byte(ms>>24)
	b[3], b[4], b[5] = byte(ms>>16), byte(ms>>8), byte(ms)
	if _, err := rand.Read(b[6:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x70 // version 7
	b[8] = b[8]&0x3f | 0x80 // RFC 9562 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// NewSecret returns a session or API secret (about 238 bits).
func NewSecret() string { return RandomString(40) }

// HashSecret is what gets stored. Secrets are long and random, so a plain
// SHA-256 is enough; slow hashing is only needed for human passwords, and
// this app has none.
func HashSecret(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}
