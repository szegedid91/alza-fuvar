-- Regisztráció: a megadott telefonszám a profilba kerül (2026-11-05)
-- A regisztrációs űrlap és a meghívó-beváltás kötelezően kéri a telefonszámot; az új fiók
-- profilja a regisztrációkor megadott számmal jön létre (egységes +ország… alakban).

create or replace function public.clean_phone(p text) returns text
language plpgsql immutable set search_path = public as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9+]', '', 'g');
  if d like '+%' then d := '+' || replace(substr(d, 2), '+', '');
  elsif d like '00%' then d := '+' || substr(d, 3);
  elsif d like '06%' then d := '+36' || substr(d, 3);
  elsif d ~ '^(20|30|31|50|70)[0-9]{7}$' then d := '+36' || d;
  elsif d ~ '^36(20|30|31|50|70)[0-9]{7}$' then d := '+' || d;
  else return null;
  end if;
  if d ~ '^\+[1-9][0-9]{7,14}$' then return d; end if;
  return null;
end $$;
revoke execute on function public.clean_phone(text) from public, anon;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, status)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          public.clean_phone(new.raw_user_meta_data->>'phone'),
          case when coalesce(new.raw_user_meta_data->>'placeholder', '') = 'true' then 'invited'::user_status else 'pending'::user_status end)
  on conflict (id) do nothing;
  return new;
end $$;
