-- Categories for items, and repeats that end.
--
-- tags: what an item belongs to, for filtering the calendar. A plain tag is a
-- category ("dsai", "prismo"); a "key:value" tag is a facet inside it
-- ("course:mai3", "type:exam"), so the calendar can offer "DSAI > course >
-- MAI3" and "DSAI > type > exam" without anyone setting up a tree.
--
-- repeat_until: the last day a repeat can fall on (a lab every Monday until
-- the semester ends). Empty: it goes on.
alter table items add column tags text[] not null default '{}';
alter table items add column repeat_until date;
alter table items add constraint items_repeat_until_check
    check (repeat_until is null or (repeat is not null and repeat_until >= due_date));
create index items_tags_idx on items using gin (tags);
