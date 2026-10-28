-- Instalación y actualización: varios proyectos, lectura con enlace y edición autorizada.
-- Ejecuta TODO el archivo en Supabase > SQL Editor. No borra datos existentes.
begin;

create table if not exists public.projectflow_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('leader', 'responsible')),
  active boolean not null default true
);
create table if not exists public.projectflow_state (
  id integer primary key,
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 10485760),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
-- Conserva el proyecto original con id = 1 y su enlace habitual.
alter table public.projectflow_state drop constraint if exists projectflow_state_id_check;
insert into public.projectflow_state(id) values (1) on conflict (id) do nothing;
alter table public.projectflow_state add column if not exists project_id uuid not null default gen_random_uuid();
create unique index if not exists projectflow_project_id on public.projectflow_state(project_id);
create sequence if not exists public.projectflow_state_id_seq;
alter table public.projectflow_state alter column id set default nextval('public.projectflow_state_id_seq');
select setval('public.projectflow_state_id_seq', greatest(
  (select coalesce(max(id), 1) from public.projectflow_state),
  (select last_value from public.projectflow_state_id_seq)
));

create table if not exists public.projectflow_project_members (
  project_id uuid not null references public.projectflow_state(project_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_manage boolean not null default false,
  active boolean not null default true,
  primary key (project_id, user_id)
);
-- Migrar una sola vez los permisos del proyecto original. Repetir no reactiva cuentas.
insert into public.projectflow_project_members(project_id, user_id, can_manage, active)
  select s.project_id, m.user_id, m.role = 'leader', m.active
  from public.projectflow_state s cross join public.projectflow_members m where s.id = 1
  on conflict do nothing;

alter table public.projectflow_members enable row level security;
alter table public.projectflow_state enable row level security;
alter table public.projectflow_project_members enable row level security;
revoke all on public.projectflow_members, public.projectflow_state, public.projectflow_project_members from anon, authenticated;
revoke all on sequence public.projectflow_state_id_seq from public, anon, authenticated;
drop policy if exists projectflow_authorized_read on public.projectflow_state;
-- Todas las lecturas y escrituras pasan por funciones con proyecto explícito.

create or replace function public.projectflow_can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projectflow_project_members
    where project_id = p_project_id and user_id = auth.uid() and active);
$$;
revoke all on function public.projectflow_can_edit_project(uuid) from public, anon, authenticated;

create or replace function public.projectflow_can_create()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projectflow_members
    where user_id = auth.uid() and active and role = 'leader');
$$;
revoke all on function public.projectflow_can_create() from public, anon, authenticated;

create or replace function public.projectflow_get_project(p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare selected public.projectflow_state; member public.projectflow_project_members;
begin
  select * into selected from public.projectflow_state
    where (p_project_id is null and id = 1) or project_id = p_project_id;
  if not found then raise exception 'El proyecto no existe.' using errcode = 'P0002'; end if;
  select * into member from public.projectflow_project_members
    where project_id = selected.project_id and user_id = auth.uid() and active;
  return jsonb_build_object('data', selected.data, 'project_id', selected.project_id,
    'name', coalesce(nullif(selected.data #>> '{projecthub.cliente.v1,project,name}', ''), 'Mi proyecto'),
    'role', case when member.user_id is null then 'viewer' when member.can_manage then 'leader' else 'responsible' end,
    'can_manage', coalesce(member.can_manage, false), 'can_create', public.projectflow_can_create(),
    'updated_at', selected.updated_at);
end;
$$;
revoke all on function public.projectflow_get_project(uuid) from public;
grant execute on function public.projectflow_get_project(uuid) to anon, authenticated;

create or replace function public.projectflow_list_projects()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.project_id,
    'name', coalesce(nullif(s.data #>> '{projecthub.cliente.v1,project,name}', ''), 'Mi proyecto')) order by s.id), '[]'::jsonb)
  from public.projectflow_state s join public.projectflow_project_members m using (project_id)
  where m.user_id = auth.uid() and m.active;
$$;
revoke all on function public.projectflow_list_projects() from public, anon;
grant execute on function public.projectflow_list_projects() to authenticated;

create or replace function public.projectflow_get_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.projectflow_get_project(null);
$$;
revoke all on function public.projectflow_get_state() from public;
grant execute on function public.projectflow_get_state() to anon, authenticated;

create or replace function public.projectflow_save_project(p_project_id uuid, p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  stored jsonb;
  item jsonb;
  section text;
  target uuid;
begin
  select project_id into target from public.projectflow_state
    where (p_project_id is null and id = 1) or project_id = p_project_id;
  if target is null or not public.projectflow_can_edit_project(target) then
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

  select data into strict stored from public.projectflow_state where project_id = target for update;
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

  if jsonb_typeof(stored #> '{equipo14.personas,schedule}') = 'array'
     and jsonb_typeof(stored #> '{equipo14.hitos,weeks}') = 'array'
     and exists (
       select 1 from jsonb_array_elements(stored #> '{equipo14.personas,schedule}') task
       where nullif(task->>'weekId', '') is not null and not exists (
         select 1 from jsonb_array_elements(stored #> '{equipo14.hitos,weeks}') week
         where week->>'id' = task->>'weekId'
       )
     ) then
    raise exception 'Una semana ya no existe. Actualiza el plan antes de asignar tareas.' using errcode = '40001';
  end if;

  update public.projectflow_state
    set data = stored, updated_at = now(), updated_by = auth.uid() where project_id = target;
  return public.projectflow_get_project(target);
end;
$$;
revoke all on function public.projectflow_save_project(uuid, jsonb) from public, anon;
grant execute on function public.projectflow_save_project(uuid, jsonb) to authenticated;


-- Compatibilidad con la web anterior: siempre escribe solo el proyecto original.
create or replace function public.projectflow_save(p_updates jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.projectflow_save_project(null, p_updates);
$$;
revoke all on function public.projectflow_save(jsonb) from public, anon;
grant execute on function public.projectflow_save(jsonb) to authenticated;

create or replace function public.projectflow_create_project(p_name text, p_start date, p_due date, p_weeks integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid; plan jsonb;
begin
  if not public.projectflow_can_create() then
    raise exception 'Solo el propietario puede crear proyectos.' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120
    or p_weeks is null or p_weeks not between 1 and 104
    or (p_start is not null and p_due is not null and p_due < p_start) then
    raise exception 'Revisa nombre, semanas y fechas del proyecto.' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'title', 'Semana ' || n,
    'objective', '', 'startDate', coalesce((p_start + (n-1)*7)::text, ''),
    'dueDate', coalesce((p_start + (n-1)*7 + 6)::text, ''),
    'done', false) order by n) into plan from generate_series(1, p_weeks) n;
  insert into public.projectflow_state(data, updated_by) values (
    jsonb_build_object('equipo14.personas', jsonb_build_object('schedule', '[]'::jsonb),
      'equipo14.hitos', jsonb_build_object('weeks', plan),
      'projecthub.cliente.v1', jsonb_build_object('schema', 1,
        'project', jsonb_build_object('name', trim(p_name), 'startDate', coalesce(p_start::text, ''), 'targetDate', coalesce(p_due::text, '')),
        'requests', '[]'::jsonb, 'reviews', '[]'::jsonb, 'agreements', '[]'::jsonb, 'activity', '[]'::jsonb)), auth.uid())
    returning project_id into new_id;
  insert into public.projectflow_project_members(project_id, user_id, can_manage) values (new_id, auth.uid(), true);
  return public.projectflow_get_project(new_id);
end;
$$;
revoke all on function public.projectflow_create_project(text,date,date,integer) from public, anon;
grant execute on function public.projectflow_create_project(text,date,date,integer) to authenticated;

create or replace function public.projectflow_list_editors(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projectflow_project_members
    where project_id = p_project_id and user_id = auth.uid() and active and can_manage) then
    raise exception 'Solo el propietario administra los permisos.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'owner', m.can_manage, 'active', m.active) order by u.email), '[]'::jsonb)
    from public.projectflow_project_members m join auth.users u on u.id = m.user_id where m.project_id = p_project_id);
end;
$$;
revoke all on function public.projectflow_list_editors(uuid) from public, anon;
grant execute on function public.projectflow_list_editors(uuid) to authenticated;

create or replace function public.projectflow_set_editor(p_project_id uuid, p_email text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_user uuid;
begin
  if not exists (select 1 from public.projectflow_project_members
    where project_id = p_project_id and user_id = auth.uid() and active and can_manage) then
    raise exception 'Solo el propietario administra los permisos.' using errcode = '42501';
  end if;
  select id into target_user from auth.users where lower(email) = lower(trim(p_email));
  if target_user is null then raise exception 'Crea primero esa cuenta en Authentication > Users de Supabase.' using errcode = '22023'; end if;
  if p_enabled is null then raise exception 'Indica el permiso.' using errcode = '22023'; end if;
  if exists (select 1 from public.projectflow_project_members where project_id = p_project_id and user_id = target_user and can_manage) then
    raise exception 'No se modifica al propietario desde esta opción.' using errcode = '22023';
  end if;
  insert into public.projectflow_project_members(project_id,user_id,active) values (p_project_id,target_user,p_enabled)
    on conflict (project_id,user_id) do update set active = excluded.active;
  return public.projectflow_list_editors(p_project_id);
end;
$$;
revoke all on function public.projectflow_set_editor(uuid,text,boolean) from public, anon;
grant execute on function public.projectflow_set_editor(uuid,text,boolean) to authenticated;

-- Alta del propietario y permisos del proyecto original: solo desde SQL Editor.
create or replace function public.projectflow_authorize(member_email text, member_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid; original_id uuid;
begin
  if member_role not in ('leader', 'responsible') or member_role is null then raise exception 'Usa leader o responsible.'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'Crea primero la cuenta en Authentication > Users.'; end if;
  insert into public.projectflow_members(user_id,role,active) values (member_id,member_role,true)
    on conflict(user_id) do update set role = excluded.role, active = true;
  select project_id into original_id from public.projectflow_state where id = 1;
  insert into public.projectflow_project_members(project_id,user_id,can_manage,active)
    values (original_id,member_id,member_role='leader',true)
    on conflict(project_id,user_id) do update set can_manage=excluded.can_manage,active=true;
end;
$$;
revoke all on function public.projectflow_authorize(text,text) from public, anon, authenticated;
commit;
