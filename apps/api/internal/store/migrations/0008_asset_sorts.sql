-- Listings can now be ordered by size, biggest or smallest first. The page
-- walk for that is (bytes, id), so it gets an index like "newest first" has.
create index assets_owner_bytes_idx on assets (owner_id, bytes desc, id desc) where deleted_at is null;
