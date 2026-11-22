package api

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	"prismocloud/internal/store"
)

// Calendars: how each category (a plain tag on items) shows in the
// calendar. The phone and the PC read the same settings from here.
//
//   GET    /v1/calendars          every calendar that has settings
//   PUT    /v1/calendars/{tag}    {name, color, group, tag_colors}; "*" is
//                                 the colours by tag all calendars share
//   DELETE /v1/calendars/{tag}    back to no settings (items keep the tag)

var calendarGroups = map[string]bool{"me": true, "study": true, "work": true, "projects": true}

func (s *Server) listCalendars(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListCalendars(r.Context(), who(r).UserID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if list == nil {
		list = []store.Calendar{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"calendars": list})
}

// calendarTag reads {tag} from the path: "*", or a plain tag (no ":").
func calendarTag(r *http.Request) (string, bool) {
	tag, err := url.PathUnescape(chi.URLParam(r, "tag"))
	if err != nil {
		return "", false
	}
	tag = strings.TrimSpace(tag)
	return tag, tag == "*" || (tag != "" && utf8.RuneCountInString(tag) <= 60 && !strings.Contains(tag, ":"))
}

// checkCalendar says what is wrong with a calendar's settings, or "".
func checkCalendar(c *store.Calendar) string {
	c.Name = strings.TrimSpace(c.Name)
	if utf8.RuneCountInString(c.Name) > 60 {
		return "the name is longer than 60 letters"
	}
	if c.Color != nil && (*c.Color < 1 || *c.Color > 6) {
		return "color is 1 to 6, or null"
	}
	if c.Group == "" {
		c.Group = "me"
	}
	if !calendarGroups[c.Group] {
		return "group is me, study, work or projects"
	}
	if len(c.TagColors) > 50 {
		return "at most 50 colours by tag"
	}
	for tag, color := range c.TagColors {
		if !strings.Contains(tag, ":") || utf8.RuneCountInString(tag) > 80 {
			return fmt.Sprintf("%q is not a key:value tag", tag)
		}
		if color < 1 || color > 6 {
			return fmt.Sprintf("the colour of %q is 1 to 6", tag)
		}
	}
	return ""
}

func (s *Server) putCalendar(w http.ResponseWriter, r *http.Request) {
	tag, ok := calendarTag(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "a calendar is a plain tag (no ':'), or '*'")
		return
	}
	var c store.Calendar
	if !decode(w, r, &c) {
		return
	}
	c.Tag = tag
	if bad := checkCalendar(&c); bad != "" {
		writeErr(w, http.StatusBadRequest, bad)
		return
	}
	saved, err := s.store.PutCalendar(r.Context(), who(r).UserID, c)
	if err != nil {
		serverError(w, r, err)
		return
	}
	s.record(r, fmt.Sprintf("set calendar %q", tag))
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCalendar(w http.ResponseWriter, r *http.Request) {
	tag, ok := calendarTag(r)
	if !ok {
		writeErr(w, http.StatusBadRequest, "a calendar is a plain tag (no ':'), or '*'")
		return
	}
	if err := s.store.DeleteCalendar(r.Context(), who(r).UserID, tag); err != nil {
		serverError(w, r, err)
		return
	}
	s.record(r, fmt.Sprintf("reset calendar %q", tag))
	w.WriteHeader(http.StatusNoContent)
}
