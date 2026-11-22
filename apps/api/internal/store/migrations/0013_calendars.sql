-- Calendars: the settings of a category (a plain tag on items, "dsai",
-- "prismo"). Items carry the tag; this row says how the calendar shows them:
-- a name to show, the calendar's colour, the group it sits in (me, study,
-- work, projects), and colours by tag ("type:exam" -> 1), which beat the
-- calendar's colour and lose to an item's own. The row with tag '*' holds
-- the colours by tag every calendar shares. A tag with no row is a calendar
-- with no colour, in "me".
create table calendars (
    owner_id    uuid not null references users (id) on delete cascade,
    tag         text not null check (tag = '*' or (char_length(tag) between 1 and 60 and position(':' in tag) = 0)),
    name        text not null default '' check (char_length(name) <= 60),
    color       smallint check (color between 1 and 6),
    grp         text not null default 'me' check (grp in ('me', 'study', 'work', 'projects')),
    tag_colors  jsonb not null default '{}' check (jsonb_typeof(tag_colors) = 'object'),
    updated_at  timestamptz not null default now(),
    primary key (owner_id, tag)
);
