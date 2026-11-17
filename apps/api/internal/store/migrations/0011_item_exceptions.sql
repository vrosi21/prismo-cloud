-- One appearance of a repeating item can differ from the rest: moved to
-- another day or hour, given its own title ("rf lab 2 + lab 1 defense"), or
-- skipped. Keyed by the day that appearance would have had:
--   {"2026-11-18": {"date": "2026-11-19", "time": "18:00", "title": "..."},
--    "2026-12-23": {"skip": true}}
-- "This and the later ones" and "all of them" are not stored here: the
-- client splits the series or moves it as a whole.
alter table items add column exceptions jsonb not null default '{}';
alter table items add constraint items_exceptions_check
    check (jsonb_typeof(exceptions) = 'object' and (repeat is not null or exceptions = '{}'));
