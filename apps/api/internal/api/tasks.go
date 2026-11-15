package api

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"

	"prismocloud/internal/store"
)

// Tasks: the time wall's to-do list and calendar. Each member has their own;
// there is nothing to share about them.

const (
	dayLayout  = "2006-01-02"
	timeLayout = "15:04"
	// Wide enough for a month grid, or a year at a glance later on.
	maxTaskSpan = 400 * 24 * time.Hour
)

func cleanTitle(title string) (string, bool) {
	title = strings.TrimSpace(title)
	return title, title != "" && utf8.RuneCountInString(title) <= 200
}

func validDay(s string) bool {
	_, err := time.Parse(dayLayout, s)
	return err == nil
}

func validTime(s string) bool {
	_, err := time.Parse(timeLayout, s)
	return err == nil && len(s) == len(timeLayout)
}

// taskError writes the answer for a failed task change and reports whether it did.
func taskError(w http.ResponseWriter, r *http.Request, err error) bool {
	var pgErr *pgconn.PgError
	switch {
	case err == nil:
		return false
	case errors.Is(err, store.ErrNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.As(err, &pgErr) && pgErr.Code == "23514": // check violation
		writeErr(w, http.StatusBadRequest, "a task with a time needs a date too")
	default:
		serverError(w, r, err)
	}
	return true
}

// listTasks: ?from=2026-11-01&to=2026-11-30, both included, plus the
// undated ones.
func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, errFrom := time.Parse(dayLayout, q.Get("from"))
	to, errTo := time.Parse(dayLayout, q.Get("to"))
	if errFrom != nil || errTo != nil || to.Before(from) || to.Sub(from) > maxTaskSpan {
		writeErr(w, http.StatusBadRequest, "from and to are dates (2026-11-01), from first, at most 400 days apart")
		return
	}
	tasks, err := s.store.ListTasks(r.Context(), who(r).UserID, q.Get("from"), q.Get("to"))
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title string  `json:"title"`
		Date  *string `json:"date"`
		Time  *string `json:"time"`
	}
	if !decode(w, r, &req) {
		return
	}
	title, ok := cleanTitle(req.Title)
	if !ok {
		writeErr(w, http.StatusBadRequest, "a task is 1 to 200 characters")
		return
	}
	if req.Date != nil && !validDay(*req.Date) || req.Time != nil && !validTime(*req.Time) {
		writeErr(w, http.StatusBadRequest, "date is 2026-11-01, time is 09:30")
		return
	}
	t, err := s.store.CreateTask(r.Context(), who(r).UserID, title, req.Date, req.Time)
	if taskError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// updateTask changes what the body names. "date": null takes the date away
// (and the time with it), "time": null only the time.
func (s *Server) updateTask(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Title *string        `json:"title"`
		Date  optionalString `json:"date"`
		Time  optionalString `json:"time"`
		Done  *bool          `json:"done"`
	}
	if !decode(w, r, &req) {
		return
	}
	change := store.TaskChange{Done: req.Done}
	if req.Title != nil {
		title, ok := cleanTitle(*req.Title)
		if !ok {
			writeErr(w, http.StatusBadRequest, "a task is 1 to 200 characters")
			return
		}
		change.Title = &title
	}
	if req.Date.Set {
		if d := req.Date.Value; d == nil {
			change.ClearDate = true
		} else if validDay(*d) {
			change.Date = d
		} else {
			writeErr(w, http.StatusBadRequest, "date is 2026-11-01")
			return
		}
	}
	if req.Time.Set {
		if t := req.Time.Value; t == nil {
			change.ClearTime = true
		} else if validTime(*t) {
			change.Time = t
		} else {
			writeErr(w, http.StatusBadRequest, "time is 09:30")
			return
		}
	}
	t, err := s.store.UpdateTask(r.Context(), who(r).UserID, id, change)
	if taskError(w, r, err) {
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if taskError(w, r, s.store.DeleteTask(r.Context(), who(r).UserID, id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
