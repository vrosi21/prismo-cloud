-- Folders inside folders. A collection with no parent sits at the top.
-- (The table keeps its name; in the app a collection is called a folder.)
alter table collections add column parent_id uuid references collections (id);
create index collections_parent_idx on collections (parent_id);

-- Names used to be unique per owner; now they only have to be unique among
-- the folders that share a parent. "nulls not distinct" makes that hold at
-- the top level too, where parent_id is null.
drop index collections_owner_name_key;
create unique index collections_sibling_name_key
    on collections (owner_id, parent_id, lower(name)) nulls not distinct;

-- A third kind of token, for a program on the owner's own computer: it may
-- add files and look at the library, but not change or delete anything.
alter table api_tokens drop constraint api_tokens_scope_check;
alter table api_tokens add constraint api_tokens_scope_check
    check (scope in ('upload', 'device', 'full'));

-- Files sent by a capture program stay with their owner unless that token
-- was told otherwise.
alter table api_tokens alter column default_visibility set default 'private';

-- A picture kept in a folder called "stickers" is a sticker.
update assets set kind = 'sticker'
where kind = 'image'
  and collection_id in (select id from collections where lower(name) = 'stickers');
