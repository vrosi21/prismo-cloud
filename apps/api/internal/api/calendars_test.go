package api

import (
	"testing"

	"prismocloud/internal/store"
)

func ip(n int) *int { return &n }

func TestCheckCalendar(t *testing.T) {
	cases := []struct {
		name string
		c    store.Calendar
		bad  bool
	}{
		{"empty is fine, group me", store.Calendar{}, false},
		{"colour and tag colours", store.Calendar{Color: ip(5), Group: "study", TagColors: map[string]int{"type:exam": 1}}, false},
		{"colour too big", store.Calendar{Color: ip(7)}, true},
		{"unknown group", store.Calendar{Group: "fun"}, true},
		{"tag colour on a plain tag", store.Calendar{TagColors: map[string]int{"exam": 1}}, true},
		{"tag colour out of range", store.Calendar{TagColors: map[string]int{"type:exam": 0}}, true},
	}
	for _, c := range cases {
		got := checkCalendar(&c.c)
		if (got != "") != c.bad {
			t.Errorf("%s: got %q", c.name, got)
		}
		if !c.bad && c.c.Group == "" {
			t.Errorf("%s: group left empty", c.name)
		}
	}
}
