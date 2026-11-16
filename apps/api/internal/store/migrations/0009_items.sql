-- One shape for everything a person writes or plans. A task, an event, a
-- notebook and a board are all items; what tells them apart is which parts
-- they use, and the kind only says what an item mainly is:
--
--   every item   title, body (Markdown), folder, colour, links to other items
--   a task       a status: it can be ticked off
--   dated        a day, maybe a time and a length, maybe a last day, maybe a
--                repeat: it is on the calendar (an event must be)
--   a board      a canvas (JSON Canvas 1.0) whose cards point at other items
--
-- So a task can carry pages of notes, a notebook can sit on the calendar, and
-- a ticket on a board is just a task placed there: the same row, seen from
-- three walls of the room.
create table items (
    id            uuid primary key default uuidv7(),
    owner_id      uuid not null references users (id) on delete cascade,
    kind          text not null check (kind in ('task', 'event', 'notebook', 'board')),
    title         text not null default '' check (char_length(title) <= 200),
    body          text not null default '' check (octet_length(body) <= 1048576),
    canvas        jsonb check (octet_length(canvas::text) <= 4194304),
    collection_id uuid references collections (id) on delete set null,
    status        text check (status in ('todo', 'doing', 'waiting', 'done')),
    done_at       timestamptz,
    -- Days and times are the owner's own wall-clock: 9:00 is 9:00 wherever
    -- they are, like a paper diary.
    due_date      date,
    due_time      time,
    end_date      date,
    minutes       integer check (minutes between 1 and 10080),
    repeat        text check (repeat in ('daily', 'weekly', 'monthly', 'yearly')),
    color         smallint check (color between 1 and 6),
    -- Counts changes to the body or the canvas, so an editor open in two
    -- places notices the other one instead of overwriting it.
    version       integer not null default 1,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz,
    check ((kind = 'task') = (status is not null)),
    check ((kind = 'board') = (canvas is not null)),
    check (kind <> 'event' or due_date is not null),
    check (due_time is null or due_date is not null),
    check (end_date is null or (due_date is not null and end_date >= due_date)),
    check (minutes is null or due_time is not null),
    check (repeat is null or due_date is not null)
);
create index items_owner_date_idx on items (owner_id, due_date) where deleted_at is null;
create index items_owner_updated_idx on items (owner_id, updated_at desc) where deleted_at is null;
create index items_owner_trash_idx on items (owner_id, deleted_at) where deleted_at is not null;
create index items_collection_idx on items (collection_id) where collection_id is not null;

-- "This task has that notebook": a link from one item to another. Read in
-- both directions; deleting either end removes it.
create table item_links (
    from_id    uuid not null references items (id) on delete cascade,
    to_id      uuid not null references items (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (from_id, to_id),
    check (from_id <> to_id)
);
create index item_links_to_idx on item_links (to_id);

-- The time wall's tasks become items, same ids.
insert into items (id, owner_id, kind, title, status, done_at, due_date, due_time, created_at, updated_at)
select id, owner_id, 'task', title,
       case when done_at is null then 'todo' else 'done' end,
       done_at, due_date, due_time, created_at, created_at
from tasks;
drop table tasks;
