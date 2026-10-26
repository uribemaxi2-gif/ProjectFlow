-- Lectura pública con el enlace; edición solo para cuentas autorizadas.
-- Ejecutar desde SQL Editor de TU proyecto de Supabase.
-- Se puede repetir: conserva los datos y las autorizaciones existentes.
begin;

create table if not exists public.projectflow_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('leader', 'responsible')),
  active boolean not null default true
);

create table if not exists public.projectflow_state (
  id integer primary key check (id = 1),
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 10485760),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.projectflow_state(id) values (1) on conflict (id) do nothing;

alter table public.projectflow_members enable row level security;
alter table public.projectflow_state enable row level security;
revoke all on public.projectflow_members, public.projectflow_state from anon, authenticated;
grant select on public.projectflow_members, public.projectflow_state to authenticated;

create or replace function public.projectflow_has_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projectflow_members
    where user_id = auth.uid() and active
      and role in ('leader', 'responsible')
  );
$$;
revoke all on function public.projectflow_has_access() from public, anon;
grant execute on function public.projectflow_has_access() to authenticated;

drop policy if exists projectflow_own_membership on public.projectflow_members;
create policy projectflow_own_membership on public.projectflow_members
  for select to authenticated using (user_id = auth.uid());
drop policy if exists projectflow_authorized_read on public.projectflow_state;
create policy projectflow_authorized_read on public.projectflow_state
  for select to authenticated using (public.projectflow_has_access());

create or replace function public.projectflow_get_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare member_role text;
begin
  select role into member_role from public.projectflow_members
    where user_id = auth.uid() and active
      and role in ('leader', 'responsible');
  return (
    select jsonb_build_object(
      'data', data,
      'role', coalesce(member_role, 'viewer'),
      'updated_at', updated_at
    )
    from public.projectflow_state where id = 1
  );
end;
$$;
revoke all on function public.projectflow_get_state() from public;
grant execute on function public.projectflow_get_state() to anon, authenticated;

-- Escritura atómica con comparación de la versión que vio el navegador.
-- Nunca acepta una sobrescritura silenciosa de datos que alguien ya cambió.
create or replace function public.projectflow_save(p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stored jsonb;
  item jsonb;
  section text;
begin
  if not public.projectflow_has_access() then
    raise exception 'Esta cuenta no tiene acceso al proyecto.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Cambios no válidos.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_updates) not between 1 and 3 then
    raise exception 'Número de cambios no válido.' using errcode = '22023';
  end if;
  if (select count(distinct value->>'key') from jsonb_array_elements(p_updates))
     <> jsonb_array_length(p_updates) then
    raise exception 'Secciones repetidas o ausentes.' using errcode = '22023';
  end if;

  select data into strict stored from public.projectflow_state where id = 1 for update;
  for item in select value from jsonb_array_elements(p_updates) loop
    section := item->>'key';
    if section not in ('equipo14.personas', 'equipo14.hitos', 'projecthub.cliente.v1')
       or jsonb_typeof(item->'value') is distinct from 'object'
       or not (item ? 'expected') then
      raise exception 'Sección o contenido no válido.' using errcode = '22023';
    end if;
    if coalesce(stored->section, 'null'::jsonb) is distinct from item->'expected' then
      raise exception 'Otra persona guardó cambios. Recarga antes de guardar de nuevo.'
        using errcode = '40001';
    end if;
    stored := jsonb_set(stored, array[section], item->'value', true);
  end loop;

  update public.projectflow_state
    set data = stored, updated_at = now(), updated_by = auth.uid() where id = 1;
  return public.projectflow_get_state();
end;
$$;
revoke all on function public.projectflow_save(jsonb) from public, anon;
grant execute on function public.projectflow_save(jsonb) to authenticated;

-- Administración exclusivamente desde SQL Editor, nunca desde el navegador.
-- Crear primero la cuenta en Authentication > Users > Add user > Create new user.
create or replace function public.projectflow_authorize(member_email text, member_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid;
begin
  if member_role not in ('leader', 'responsible') or member_role is null then
    raise exception 'Usa leader (líder) o responsible (responsable).';
  end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then
    raise exception 'Crea primero la cuenta en Authentication > Users.';
  end if;
  insert into public.projectflow_members(user_id, role, active)
    values (member_id, member_role, true)
    on conflict (user_id) do update set role = excluded.role, active = true;
end;
$$;
revoke all on function public.projectflow_authorize(text, text) from public, anon, authenticated;

commit;

-- Después de crear cada cuenta, ejecutar SOLO la línea que corresponda,
-- reemplazando el correo de ejemplo por el de la persona autorizada:
-- select public.projectflow_authorize('lider@ejemplo.com', 'leader');
-- select public.projectflow_authorize('responsable@ejemplo.com', 'responsible');
-- Para revocar acceso sin borrar sus registros:
-- update public.projectflow_members set active = false
-- where user_id = (select id from auth.users where email = 'persona@ejemplo.com');
