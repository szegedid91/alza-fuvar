-- Munkatárs nevének átírása a vezető által (Tagok oldal). A név mindenhol az azonosítóból jön (beosztás, bér,
-- Box-lapok, kimutatások), ezért az átírás a régi hónapokban is az új nevet mutatja.
-- A még be nem váltott meghívó nevét is átírjuk — különben a regisztráció a régi névre írná vissza a profilt.
create or replace function public.rename_member(target_id uuid, p_full_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Nincs jogosultság'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then raise exception 'A név 2 és 120 karakter között legyen'; end if;
  select * into v_target from public.profiles where id = target_id;
  if v_target.id is null then raise exception 'A felhasználó nem található'; end if;
  if target_id <> auth.uid() then
    if not public.is_manager_or_admin() then raise exception 'Nincs jogosultság'; end if;
    if not public.is_admin() then
      if v_target.workspace_id is null or v_target.workspace_id not in (select public.user_workspace_ids()) then
        raise exception 'Csak a saját munkaterületed tagjának nevét módosíthatod';
      end if;
      -- SEC-12: vezető (menedzser / admin) adatait csak admin módosíthatja
      if v_target.role in ('admin', 'manager') then raise exception 'Vezető nevét csak admin módosíthatja'; end if;
    end if;
  end if;
  update public.profiles set full_name = v_name where id = target_id;
  update public.invites set full_name = v_name where placeholder_id = target_id and used_at is null;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_name) where id = target_id;
end $$;
revoke all on function public.rename_member(uuid, text) from public, anon;
grant execute on function public.rename_member(uuid, text) to authenticated;
