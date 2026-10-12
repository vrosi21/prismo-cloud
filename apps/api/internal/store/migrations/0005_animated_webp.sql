-- The worker can now play animated WebP, the format most sites hand out when
-- a "GIF" is saved from them. Until now such a file was stored but never
-- opened: it has no size on record. Those are looked at again.
insert into jobs (kind, payload)
select 'reprocess_asset', jsonb_build_object('asset_id', id::text)
from assets
where status = 'ready' and mime = 'image/webp' and width is null;
