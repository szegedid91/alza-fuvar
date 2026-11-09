-- Meghívó emailben (2026-11-09)
-- A meghívó linkje emailben is kiküldhető (manage-invite: send_email). Itt tároljuk, mikor ment ki
-- utoljára, hogy a Tagok oldalon látsszon. A meghívó alapértelmezett érvényessége a manage-invite
-- függvényben 30 nap lett (eddig a tábla 7 napos alapértelmezése érvényesült).

alter table public.invites add column if not exists email_sent_at timestamptz;
comment on column public.invites.email_sent_at is 'Mikor ment ki utoljára emailben a meghívó linkje (NULL = még nem).';
