-- SEC: az admin szerepű meghívót csak admin láthatja és törölheti.
-- A meghívó azonosítója maga a beváltó kulcs (/meghivo#<id>): ha a munkaterület menedzsere látja egy függő
-- admin-meghívó sorát, a linkkel maga válthatja be, és admin fiókot kap. A menedzser a saját (crew / manager)
-- meghívóit ugyanúgy látja és kezeli, mint eddig.
drop policy if exists inv_select on public.invites;
create policy inv_select on public.invites for select to authenticated
  using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id)
         and (role <> 'admin'::public.user_role or (select public.is_admin())));

drop policy if exists inv_delete on public.invites;
create policy inv_delete on public.invites for delete to authenticated
  using ((select public.is_manager_or_admin()) and public.can_access_workspace(workspace_id)
         and (role <> 'admin'::public.user_role or (select public.is_admin())));
