-- The worker now also makes an H.264 copy of an MP4 or WebM whose picture
-- not every browser can play (HEVC from a phone, 10-bit exports). Videos
-- stored before that are looked at again; the ones that play everywhere
-- only get their thumbnail and GIF made anew.
insert into jobs (kind, payload)
select 'reprocess_asset', jsonb_build_object('asset_id', a.id::text)
from assets a
where a.status = 'ready' and a.kind = 'video'
  and a.mime in ('video/mp4', 'video/webm')
  and not exists (select 1 from variants v where v.asset_id = a.id and v.role = 'mp4');
