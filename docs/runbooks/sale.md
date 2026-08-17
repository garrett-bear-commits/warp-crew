# Scheduling a sale (no deploy)

1. Segment (optional): `POST /admin/v1/liveops/segments {id, predicate}` — preview with `GET /admin/v1/liveops/segments/:id/preview`.
2. Schedule: `POST /admin/v1/liveops/schedules {id:'summer-sale', kind:'sale', startsAt, endsAt, payload:{discount:50}, active:true}` — appears in `GET /v1/config.schedules` and `GET /v1/schedules` while active.
3. Flag: `POST /admin/v1/liveops/flags {key:'sale.summer', enabled:true, value:true, rolloutPercent:100}` — or 50 % for a canary (sticky per player).
4. Announcement: `POST /admin/v1/announcements {id, title, body, startsAt, endsAt, segmentId?}`.
5. Verify from the client (`/v1/config` authed) and the inspector; the template game shows the sale banner within one config refresh.
