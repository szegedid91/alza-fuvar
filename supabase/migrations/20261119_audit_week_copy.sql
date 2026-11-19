-- Napló: a heti beosztás másolása egy külön, jól látható bejegyzést kap (a másolt sorok egyenként is naplózódnak,
-- de azokból nem látszik, hogy másolás volt). A bejegyzést csak a szerver írja, a hívó azonosítójával.
create or replace function public.log_week_copy(p_workspace_id uuid, p_from_week date, p_to_week date, p_count integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_manager_or_admin() or not public.can_access_workspace(p_workspace_id) then
    raise exception 'Nincs jogosultság';
  end if;
  if p_count is null or p_count < 0 or p_count > 5000 or p_from_week is null or p_to_week is null then raise exception 'Érvénytelen adat'; end if;
  insert into public.audit_log (workspace_id, actor_id, action, entity, entity_id, detail)
  values (p_workspace_id, auth.uid(), 'COPY_WEEK', 'shifts', null,
          jsonb_build_object('new', jsonb_build_object('from_week', p_from_week, 'to_week', p_to_week, 'count', p_count)));
end $$;
revoke all on function public.log_week_copy(uuid, date, date, integer) from public, anon;
grant execute on function public.log_week_copy(uuid, date, date, integer) to authenticated;

-- „Ki mit csinált” szűrés: egy ember legutóbbi bejegyzései gyorsan
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
