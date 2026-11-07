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
create table if not exists public.projectflow_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projectflow_state(project_id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254),
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  prepared_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id) on delete set null,
  unique (project_id, email)
);
-- Asignar roles una sola vez. No restaurar permisos al repetir la actualización.
alter table public.projectflow_project_members add column if not exists role text;
update public.projectflow_project_members set role = case when can_manage then 'admin' else 'pm_junior' end where role is null;
alter table public.projectflow_project_members alter column role set default 'pm_junior';
alter table public.projectflow_project_members alter column role set not null;
alter table public.projectflow_project_members drop constraint if exists projectflow_member_role_check;
alter table public.projectflow_project_members add constraint projectflow_member_role_check
  check (role in ('viewer', 'qa', 'pm_junior', 'pm', 'admin') and can_manage = (role = 'admin'));
alter table public.projectflow_invitations add column if not exists role text;
update public.projectflow_invitations set role = 'pm_junior' where role is null;
alter table public.projectflow_invitations alter column role set default 'qa';
alter table public.projectflow_invitations alter column role set not null;
alter table public.projectflow_invitations drop constraint if exists projectflow_invitation_role_check;
alter table public.projectflow_invitations add constraint projectflow_invitation_role_check
  check (role in ('viewer', 'qa', 'pm_junior', 'pm', 'admin'));
-- Recibos privados: reintentar una solicitud no duplica ni resucita registros.
create table if not exists public.projectflow_request_receipts (
  project_id uuid not null references public.projectflow_state(project_id) on delete cascade,
  request_id uuid not null,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  primary key (project_id, request_id)
);
alter table public.projectflow_request_receipts enable row level security;
revoke all on public.projectflow_request_receipts from public, anon, authenticated;
alter table public.projectflow_invitations enable row level security;
revoke all on public.projectflow_invitations from public, anon, authenticated;
-- Migrar una sola vez los permisos del proyecto original. Repetir no reactiva cuentas.
insert into public.projectflow_project_members(project_id, user_id, can_manage, active, role)
  select s.project_id, m.user_id, m.role = 'leader', m.active, case when m.role = 'leader' then 'admin' else 'pm_junior' end
  from public.projectflow_state s cross join public.projectflow_members m where s.id = 1
  on conflict do nothing;

-- Admin es global. Migrar los antiguos admins una sola vez; las filas inactivas
-- se conservan para que repetir setup nunca restaure una administración retirada.
-- Una invitación antigua de admin local no debe convertirse en un alta global.
do $$ begin
  if to_regclass('public.projectflow_global_admins') is null then
    update public.projectflow_invitations set role = 'pm' where role = 'admin' and status = 'pending';
  end if;
end $$;
create table if not exists public.projectflow_global_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true
);
alter table public.projectflow_global_admins enable row level security;
revoke all on public.projectflow_global_admins from public, anon, authenticated;
insert into public.projectflow_global_admins(user_id)
  select distinct user_id from public.projectflow_project_members where role = 'admin' and active
  on conflict do nothing;
update public.projectflow_project_members set role = 'pm', can_manage = false where role = 'admin';

create or replace function public.projectflow_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.projectflow_global_admins where user_id = p_user_id and active);
$$;
revoke all on function public.projectflow_is_admin(uuid) from public, anon, authenticated;

create or replace function public.projectflow_user_role(p_project_id uuid, p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when public.projectflow_is_admin(p_user_id) then 'admin' else coalesce(
    (select role from public.projectflow_project_members where project_id = p_project_id and user_id = p_user_id and active), 'viewer') end;
$$;
revoke all on function public.projectflow_user_role(uuid,uuid) from public, anon, authenticated;

alter table public.projectflow_members enable row level security;
alter table public.projectflow_state enable row level security;
alter table public.projectflow_project_members enable row level security;
revoke all on public.projectflow_members, public.projectflow_state, public.projectflow_project_members from public, anon, authenticated;
revoke all on sequence public.projectflow_state_id_seq from public, anon, authenticated;
drop policy if exists projectflow_authorized_read on public.projectflow_state;
-- Todas las lecturas y escrituras pasan por funciones con proyecto explícito.

create or replace function public.projectflow_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select public.projectflow_user_role(p_project_id, auth.uid());
$$;
revoke all on function public.projectflow_role(uuid) from public, anon, authenticated;

create or replace function public.projectflow_can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.projectflow_role(p_project_id) in ('pm_junior', 'pm', 'admin');
$$;
revoke all on function public.projectflow_can_edit_project(uuid) from public, anon, authenticated;

create or replace function public.projectflow_can_create()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.projectflow_is_admin(auth.uid());
$$;
revoke all on function public.projectflow_can_create() from public, anon, authenticated;

create or replace function public.projectflow_get_project(p_project_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare selected public.projectflow_state; effective_role text;
begin
  select * into selected from public.projectflow_state
    where (p_project_id is null and id = 1) or project_id = p_project_id;
  if not found then raise exception 'El proyecto no existe.' using errcode = 'P0002'; end if;
  effective_role := public.projectflow_role(selected.project_id);
  return jsonb_build_object('data', selected.data, 'project_id', selected.project_id,
    'name', coalesce(nullif(selected.data #>> '{projecthub.cliente.v1,project,name}', ''), 'Mi proyecto'),
    -- role conserva la respuesta antigua para pestañas que aún tengan la web anterior.
    'role', case when effective_role = 'admin' then 'leader' when effective_role in ('pm_junior', 'pm') then 'responsible' else 'viewer' end,
    'project_role', coalesce(effective_role, 'viewer'), 'roles_version', 1, 'scope_version', 2,
    'can_manage', effective_role in ('pm', 'admin'),
    'can_invite', coalesce(effective_role in ('pm', 'admin'), false),
    'can_submit', coalesce(effective_role in ('qa', 'pm_junior', 'pm', 'admin'), false),
    'can_create', public.projectflow_can_edit_project(selected.project_id),
    'updated_at', selected.updated_at);
end;
$$;
revoke all on function public.projectflow_get_project(uuid) from public;
grant execute on function public.projectflow_get_project(uuid) to anon, authenticated;

create or replace function public.projectflow_list_projects()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.project_id,
    'name', coalesce(nullif(s.data #>> '{projecthub.cliente.v1,project,name}', ''), 'Mi proyecto')) order by s.id), '[]'::jsonb)
  from public.projectflow_state s where public.projectflow_is_admin(auth.uid()) or exists (
    select 1 from public.projectflow_project_members m where m.project_id = s.project_id and m.user_id = auth.uid() and m.active);
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
  if not public.projectflow_can_edit_project(target) then
    raise exception 'Tu permiso de edición cambió.' using errcode = '42501'; end if;
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
  insert into public.projectflow_project_members(project_id, user_id, can_manage, role) values (new_id, auth.uid(), false, 'pm');
  return public.projectflow_get_project(new_id);
end;
$$;
revoke all on function public.projectflow_create_project(text,date,date,integer) from public, anon;
grant execute on function public.projectflow_create_project(text,date,date,integer) to authenticated;

-- Un PM conserva su nivel al crear un proyecto. Los admins globales tienen acceso
-- automáticamente; crear proyectos no permite ascenderse de rol.
create or replace function public.projectflow_create_project_from(p_source_project_id uuid, p_name text, p_start date, p_due date, p_weeks integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare creator_role text; new_id uuid; plan jsonb;
begin
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_source_project_id for update;
  creator_role := public.projectflow_role(p_source_project_id);
  if creator_role not in ('pm_junior', 'pm', 'admin') then
    raise exception 'Solo PM menor, PM y admin pueden crear proyectos.' using errcode = '42501'; end if;
  if creator_role = 'admin' then return public.projectflow_create_project(p_name, p_start, p_due, p_weeks); end if;
  if not exists (select 1 from public.projectflow_global_admins where active) then
    raise exception 'El proyecto de origen necesita un admin activo.' using errcode = '22023'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or p_weeks is null or p_weeks not between 1 and 104
    or (p_start is not null and p_due is not null and p_due < p_start) then
    raise exception 'Revisa nombre, semanas y fechas del proyecto.' using errcode = '22023'; end if;
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'title', 'Semana ' || n,
    'objective', '', 'startDate', coalesce((p_start + (n-1)*7)::text, ''),
    'dueDate', coalesce((p_start + (n-1)*7 + 6)::text, ''), 'done', false) order by n)
    into plan from generate_series(1, p_weeks) n;
  insert into public.projectflow_state(data, updated_by) values (
    jsonb_build_object('equipo14.personas', jsonb_build_object('schedule', '[]'::jsonb),
      'equipo14.hitos', jsonb_build_object('weeks', plan),
      'projecthub.cliente.v1', jsonb_build_object('schema', 1,
        'project', jsonb_build_object('name', trim(p_name), 'startDate', coalesce(p_start::text, ''), 'targetDate', coalesce(p_due::text, '')),
        'requests', '[]'::jsonb, 'reviews', '[]'::jsonb, 'agreements', '[]'::jsonb, 'activity', '[]'::jsonb)), auth.uid())
    returning project_id into new_id;
  insert into public.projectflow_project_members(project_id,user_id,role,can_manage) values (new_id,auth.uid(),creator_role,false);
  return public.projectflow_get_project(new_id);
end;
$$;
revoke all on function public.projectflow_create_project_from(uuid,text,date,date,integer) from public, anon;
grant execute on function public.projectflow_create_project_from(uuid,text,date,date,integer) to authenticated;

-- El Consultor / QA solo puede anexar una solicitud. Nunca escribe el documento
-- completo, ni decide el estado, la identidad del autor o el historial.
create or replace function public.projectflow_submit_request(p_project_id uuid, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stored jsonb; section jsonb; entry jsonb; v_request_id uuid; receipt public.projectflow_request_receipts;
  field text; max_length integer; history jsonb;
begin
  select data into stored from public.projectflow_state where project_id = p_project_id for update;
  if not found or public.projectflow_role(p_project_id) not in ('qa', 'pm_junior', 'pm', 'admin') then
    raise exception 'Tu rol no permite enviar solicitudes a este proyecto.' using errcode = '42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_request) k
    where k not in ('id','title','category','priority','detail','benefit','module','requestedBy','dueDate','reviewRequired','link')) then
    raise exception 'La solicitud contiene campos no permitidos.' using errcode = '22023'; end if;
  if coalesce(p_request->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'El identificador de solicitud no es válido.' using errcode = '22023'; end if;
  v_request_id := (p_request->>'id')::uuid;
  foreach field in array array['id','title','category','priority','detail','benefit','module','requestedBy','dueDate','link'] loop
    max_length := case field when 'detail' then 5000 when 'benefit' then 3500 when 'title' then 160 when 'link' then 500 else 120 end;
    if p_request ? field and (jsonb_typeof(p_request->field) <> 'string' or length(p_request->>field) > max_length) then
      raise exception 'Revisa el contenido y la longitud de los campos.' using errcode = '22023'; end if;
  end loop;
  if length(trim(coalesce(p_request->>'title',''))) = 0 or length(trim(coalesce(p_request->>'detail',''))) = 0 then
    raise exception 'Completa el título y la descripción.' using errcode = '22023'; end if;
  if coalesce(p_request->>'category','Nueva funcionalidad') not in ('Nueva funcionalidad','Modificación','Corrección de error','Consulta','Otro')
    or coalesce(p_request->>'priority','Media') not in ('Media','Alta','Baja')
    or (p_request ? 'reviewRequired' and jsonb_typeof(p_request->'reviewRequired') <> 'boolean') then
    raise exception 'Revisa el tipo y la prioridad de la solicitud.' using errcode = '22023'; end if;
  if coalesce(p_request->>'dueDate','') <> '' then
    if (p_request->>'dueDate') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'La fecha no es válida.' using errcode = '22023'; end if;
    perform (p_request->>'dueDate')::date;
  end if;
  select * into receipt from public.projectflow_request_receipts where project_id = p_project_id and projectflow_request_receipts.request_id = v_request_id;
  if found then
    if receipt.submitted_by = auth.uid() and receipt.payload = p_request then return public.projectflow_get_project(p_project_id); end if;
    raise exception 'Ese identificador ya se utilizó. Abre una nueva solicitud.' using errcode = '22023'; end if;
  section := coalesce(stored->'projecthub.cliente.v1', jsonb_build_object('schema',1,'project','{}'::jsonb,
    'requests','[]'::jsonb,'reviews','[]'::jsonb,'agreements','[]'::jsonb,'activity','[]'::jsonb));
  if jsonb_typeof(coalesce(section->'requests','[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(section->'requests','[]'::jsonb)) >= 10000 then
    raise exception 'No se pueden agregar más solicitudes a este proyecto.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(section->'requests','[]'::jsonb)) r where r->>'id' = v_request_id::text) then
    raise exception 'Ese identificador ya está ocupado.' using errcode = '22023'; end if;
  entry := jsonb_build_object('id',v_request_id,'title',trim(p_request->>'title'),'detail',trim(p_request->>'detail'),
    'category',coalesce(p_request->>'category','Nueva funcionalidad'),'priority',coalesce(p_request->>'priority','Media'),
    'benefit',coalesce(p_request->>'benefit',''),'module',coalesce(p_request->>'module',''),
    'requestedBy',coalesce(nullif(trim(p_request->>'requestedBy'),''),'Consultor / QA'),
    'dueDate',coalesce(p_request->>'dueDate',''),'link',coalesce(p_request->>'link',''),
    'reviewRequired',coalesce(p_request->'reviewRequired','true'::jsonb),'status','Pendiente','decision','',
    'requestedRole',public.projectflow_role(p_project_id),
    'createdDate',to_char(now() at time zone 'UTC','YYYY-MM-DD'), 'createdAt',now(),'updatedAt',now(),'submittedBy',auth.uid());
  section := jsonb_set(section,'{requests}',coalesce(section->'requests','[]'::jsonb) || jsonb_build_array(entry));
  history := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',now(),'kind','requests',
    'title','Solicitud recibida','detail',entry->>'title')) || coalesce(section->'activity','[]'::jsonb);
  section := jsonb_set(section,'{activity}',(select jsonb_agg(value order by ord) from jsonb_array_elements(history) with ordinality as h(value,ord) where ord <= 180));
  insert into public.projectflow_request_receipts values (p_project_id,v_request_id,auth.uid(),p_request);
  update public.projectflow_state set data = jsonb_set(stored,'{projecthub.cliente.v1}',section), updated_at = now(), updated_by = auth.uid() where project_id = p_project_id;
  return public.projectflow_get_project(p_project_id);
end;
$$;
revoke all on function public.projectflow_submit_request(uuid,jsonb) from public, anon;
grant execute on function public.projectflow_submit_request(uuid,jsonb) to authenticated;

create or replace function public.projectflow_list_editors(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.projectflow_role(p_project_id) not in ('pm', 'admin') then
    raise exception 'Solo el Admin global o el PM del proyecto pueden administrar permisos.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('email', u.email,
    'owner', public.projectflow_is_admin(u.id), 'active', m.active or public.projectflow_is_admin(u.id),
    'role', case when public.projectflow_is_admin(u.id) then 'admin' else m.role end,
    'self', u.id = auth.uid()) order by u.email), '[]'::jsonb)
    from auth.users u left join public.projectflow_project_members m on m.user_id = u.id and m.project_id = p_project_id
    where m.user_id is not null or public.projectflow_is_admin(u.id));
end;
$$;
revoke all on function public.projectflow_list_editors(uuid) from public, anon;
grant execute on function public.projectflow_list_editors(uuid) to authenticated;

create or replace function public.projectflow_update_member(p_project_id uuid, p_email text, p_role text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_user uuid; previous public.projectflow_project_members;
begin
  -- Serializar todos los cambios de permisos por proyecto, antes de tocar miembros o invitaciones.
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_project_id for update;
  if public.projectflow_role(p_project_id) not in ('pm', 'admin') then
    raise exception 'Solo el Admin global o el PM del proyecto pueden administrar permisos.' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('viewer', 'qa', 'pm_junior', 'pm', 'admin') or p_active is null then
    raise exception 'Selecciona un rol válido.' using errcode = '22023'; end if;
  select id into target_user from auth.users where lower(email) = lower(trim(p_email));
  if target_user is null then raise exception 'Envía una invitación para que esa persona cree su cuenta.' using errcode = '22023'; end if;
  select * into previous from public.projectflow_project_members where project_id = p_project_id and user_id = target_user;
  if public.projectflow_role(p_project_id) = 'pm' and
    (p_role not in ('viewer','qa','pm_junior') or previous.role in ('pm','admin')
      or public.projectflow_is_admin(target_user) or target_user = auth.uid()) then
    raise exception 'El PM solo administra roles inferiores al suyo dentro de su proyecto.' using errcode = '42501'; end if;
  if public.projectflow_is_admin(target_user) and (not p_active or p_role <> 'admin') then
    if not exists(select 1 from public.projectflow_global_admins where active and user_id <> target_user) then
      raise exception 'La web debe conservar al menos un admin global.' using errcode = '22023'; end if;
    update public.projectflow_global_admins set active = false where user_id = target_user;
    update public.projectflow_invitations set status = 'revoked' where email = lower(trim(p_email)) or accepted_by = target_user;
  end if;
  if p_role = 'admin' and p_active then
    insert into public.projectflow_global_admins(user_id) values (target_user)
      on conflict(user_id) do update set active = true;
  end if;
  update public.projectflow_invitations set status = 'revoked'
    where project_id = p_project_id and (email = lower(trim(p_email)) or accepted_by = target_user);
  insert into public.projectflow_project_members(project_id,user_id,active,role,can_manage)
    values (p_project_id,target_user,p_active,case when p_role = 'admin' then 'pm' else p_role end,false)
    on conflict (project_id,user_id) do update set active = excluded.active, role = excluded.role, can_manage = excluded.can_manage;
  return case when public.projectflow_role(p_project_id) in ('pm','admin') then public.projectflow_list_editors(p_project_id) else '[]'::jsonb end;
end;
$$;
revoke all on function public.projectflow_update_member(uuid,text,text,boolean) from public, anon, authenticated;

create or replace function public.projectflow_set_member_role(p_project_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_project_id for update;
  if public.projectflow_role(p_project_id) not in ('pm', 'admin') then
    raise exception 'Solo el Admin global o el PM del proyecto pueden administrar roles.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users u left join public.projectflow_project_members m on u.id = m.user_id
    where lower(u.email) = lower(trim(p_email)) and ((m.project_id = p_project_id and m.active) or public.projectflow_is_admin(u.id))) then
    raise exception 'La persona debe aceptar su invitación antes de asignarle otro rol.' using errcode = '22023'; end if;
  return public.projectflow_update_member(p_project_id, p_email, p_role, true);
end;
$$;
revoke all on function public.projectflow_set_member_role(uuid,text,text) from public, anon;
grant execute on function public.projectflow_set_member_role(uuid,text,text) to authenticated;

-- Compatibilidad con la web anterior; conserva las comprobaciones de jerarquía.
create or replace function public.projectflow_set_editor(p_project_id uuid, p_email text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_role text;
begin
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_project_id for update;
  select m.role into previous_role from public.projectflow_project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p_project_id and lower(u.email) = lower(trim(p_email));
  return public.projectflow_update_member(p_project_id, p_email, case when exists(select 1 from auth.users u where lower(u.email) = lower(trim(p_email)) and public.projectflow_is_admin(u.id)) then 'admin' else coalesce(previous_role, 'pm_junior') end, p_enabled);
end;
$$;
revoke all on function public.projectflow_set_editor(uuid,text,boolean) from public, anon;
grant execute on function public.projectflow_set_editor(uuid,text,boolean) to authenticated;

create or replace function public.projectflow_prepare_invitation_role(p_project_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare recipient text := lower(trim(p_email)); invitation public.projectflow_invitations; sender_role text;
begin
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_project_id for update;
  sender_role := public.projectflow_role(p_project_id);
  if sender_role not in ('pm', 'admin') then raise exception 'Solo PM y admin pueden invitar.' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('viewer', 'qa', 'pm_junior', 'pm', 'admin') then
    raise exception 'Selecciona un rol válido.' using errcode = '22023'; end if;
  if sender_role = 'pm' and p_role not in ('viewer','qa','pm_junior') then
    raise exception 'El PM solo puede invitar como Usuario, Consultor / QA o PM menor.' using errcode = '42501'; end if;
  if recipient is null or length(recipient) > 254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Escribe un correo válido.' using errcode = '22023'; end if;
  if exists (select 1 from public.projectflow_project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p_project_id and lower(u.email) = recipient and (m.active or (sender_role = 'pm' and m.role in ('pm','admin')))) then
    raise exception 'Esa cuenta ya tiene un rol o un permiso retirado. Solo el admin administra su acceso.' using errcode = '22023'; end if;
  if exists(select 1 from auth.users u where lower(u.email) = recipient and public.projectflow_is_admin(u.id)) then
    raise exception 'Esta cuenta ya es Admin global.' using errcode = '22023'; end if;
  select * into invitation from public.projectflow_invitations where project_id = p_project_id and email = recipient for update;
  if found and sender_role = 'pm' and invitation.role in ('pm','admin') then
    raise exception 'El PM no puede modificar invitaciones de PM o Admin.' using errcode = '42501'; end if;
  if found and invitation.prepared_at > now() - interval '1 minute' then
    raise exception 'Espera un minuto antes de volver a enviar a ese correo.' using errcode = '22023'; end if;
  if (select count(*) from public.projectflow_invitations where invited_by = auth.uid()
      and prepared_at > now() - interval '1 hour') >= 20 then
    raise exception 'Alcanzaste el límite de invitaciones. Inténtalo más tarde.' using errcode = '22023'; end if;
  insert into public.projectflow_invitations(project_id, email, invited_by, role) values (p_project_id, recipient, auth.uid(), p_role)
    on conflict (project_id, email) do update set id = gen_random_uuid(), invited_by = auth.uid(),
      status = 'pending', role = excluded.role, prepared_at = now(), expires_at = now() + interval '7 days', accepted_by = null
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'email', invitation.email,
    'project_id', invitation.project_id, 'expires_at', invitation.expires_at, 'role', invitation.role);
end;
$$;
revoke all on function public.projectflow_prepare_invitation_role(uuid,text,text) from public, anon;
grant execute on function public.projectflow_prepare_invitation_role(uuid,text,text) to authenticated;

create or replace function public.projectflow_prepare_invitation(p_project_id uuid, p_email text)
returns jsonb language sql security definer set search_path = '' as $$
  select public.projectflow_prepare_invitation_role(p_project_id, p_email,
    case when public.projectflow_role(p_project_id) = 'admin' then 'pm_junior' else 'qa' end);
$$;
revoke all on function public.projectflow_prepare_invitation(uuid,text) from public, anon;
grant execute on function public.projectflow_prepare_invitation(uuid,text) to authenticated;

create or replace function public.projectflow_list_invitations(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.projectflow_role(p_project_id) not in ('pm', 'admin') then
    raise exception 'Solo PM y admin pueden consultar invitaciones.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email,
    'expires_at', expires_at, 'expired', expires_at <= now(), 'role', role) order by prepared_at desc), '[]'::jsonb)
    from public.projectflow_invitations where project_id = p_project_id and status = 'pending'
      and (public.projectflow_role(p_project_id) = 'admin' or role in ('viewer','qa','pm_junior')));
end;
$$;
revoke all on function public.projectflow_list_invitations(uuid) from public, anon;
grant execute on function public.projectflow_list_invitations(uuid) to authenticated;

create or replace function public.projectflow_cancel_invitation(p_project_id uuid, p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = p_project_id for update;
  if public.projectflow_role(p_project_id) not in ('pm', 'admin') then
    raise exception 'Solo PM y admin pueden cancelar invitaciones.' using errcode = '42501'; end if;
  update public.projectflow_invitations set status = 'revoked'
    where project_id = p_project_id and id = p_invitation_id and status = 'pending'
      and (public.projectflow_role(p_project_id) = 'admin' or role in ('viewer','qa','pm_junior'));
  if not found then raise exception 'La invitación cambió o no puedes cancelarla. Actualiza la lista.' using errcode = '22023'; end if;
end;
$$;
revoke all on function public.projectflow_cancel_invitation(uuid,uuid) from public, anon;
grant execute on function public.projectflow_cancel_invitation(uuid,uuid) to authenticated;

create or replace function public.projectflow_get_invitation(p_invitation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare invitation public.projectflow_invitations; recipient auth.users;
begin
  select * into recipient from auth.users where id = auth.uid();
  select * into invitation from public.projectflow_invitations where id = p_invitation_id;
  if invitation.id is null then raise exception 'El enlace de invitación ya no es válido.' using errcode = '22023'; end if;
  if recipient.id is null or recipient.email_confirmed_at is null or lower(recipient.email) is distinct from invitation.email then
    raise exception 'Esta invitación no corresponde a tu cuenta o tu correo no está confirmado.' using errcode = '42501'; end if;
  if invitation.status = 'revoked' or (invitation.status = 'pending' and invitation.expires_at <= now()) then
    raise exception 'La invitación venció o fue cancelada. Pide que la envíen de nuevo.' using errcode = '22023'; end if;
  if invitation.status = 'pending' and not (public.projectflow_user_role(invitation.project_id, invitation.invited_by) = 'admin' or
      (public.projectflow_user_role(invitation.project_id, invitation.invited_by) = 'pm' and invitation.role in ('viewer','qa','pm_junior'))) then
    raise exception 'La persona que invitó ya no puede conceder este acceso.' using errcode = '42501'; end if;
  if invitation.status = 'accepted' and (invitation.accepted_by is distinct from auth.uid() or not exists (
    select 1 from public.projectflow_project_members where project_id = invitation.project_id and user_id = auth.uid() and active)) then
    raise exception 'Este permiso ya no está activo.' using errcode = '42501'; end if;
  return jsonb_build_object('project_id', invitation.project_id, 'email', invitation.email,
    'name', (select coalesce(nullif(data #>> '{projecthub.cliente.v1,project,name}', ''), 'Mi proyecto')
      from public.projectflow_state where project_id = invitation.project_id),
    'role', invitation.role, 'accepted', invitation.status = 'accepted', 'has_password', coalesce(recipient.encrypted_password, '') <> '');
end;
$$;
revoke all on function public.projectflow_get_invitation(uuid) from public, anon;
grant execute on function public.projectflow_get_invitation(uuid) to authenticated;

create or replace function public.projectflow_accept_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invitation public.projectflow_invitations; result jsonb;
begin
  select * into invitation from public.projectflow_invitations where id = p_invitation_id;
  if not found then raise exception 'El enlace de invitación ya no es válido.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(724011);
  perform 1 from public.projectflow_state where project_id = invitation.project_id for update;
  select * into invitation from public.projectflow_invitations where id = p_invitation_id for update;
  result := public.projectflow_get_invitation(p_invitation_id);
  if invitation.status = 'accepted' then return result; end if;
  if not (result->>'has_password')::boolean then
    raise exception 'Crea primero tu contraseña personal.' using errcode = '22023'; end if;
  if exists (select 1 from public.projectflow_project_members where project_id = invitation.project_id and user_id = auth.uid() and active) then
    raise exception 'Ya tienes un rol en este proyecto. El admin debe cambiarlo desde los permisos.' using errcode = '22023'; end if;
  insert into public.projectflow_project_members(project_id, user_id, can_manage, active, role)
    values (invitation.project_id, auth.uid(), false, true, case when invitation.role = 'admin' then 'pm' else invitation.role end)
    on conflict (project_id, user_id) do update set active = true, role = excluded.role, can_manage = excluded.can_manage;
  if invitation.role = 'admin' then
    insert into public.projectflow_global_admins(user_id) values(auth.uid()) on conflict(user_id) do update set active = true;
  end if;
  update public.projectflow_invitations set status = 'accepted', accepted_by = auth.uid() where id = p_invitation_id;
  return public.projectflow_get_invitation(p_invitation_id);
end;
$$;
revoke all on function public.projectflow_accept_invitation(uuid) from public, anon;
grant execute on function public.projectflow_accept_invitation(uuid) to authenticated;

-- Alta del propietario y permisos del proyecto original: solo desde SQL Editor.
create or replace function public.projectflow_authorize(member_email text, member_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare member_id uuid; original_id uuid;
begin
  if member_role not in ('leader', 'responsible') or member_role is null then raise exception 'Usa leader o responsible.'; end if;
  select id into member_id from auth.users where lower(email) = lower(trim(member_email));
  if member_id is null then raise exception 'Crea primero la cuenta en Authentication > Users.'; end if;
  perform pg_advisory_xact_lock(724011);
  if member_role = 'leader' then
    insert into public.projectflow_global_admins(user_id) values(member_id) on conflict(user_id) do update set active = true;
  end if;
  insert into public.projectflow_members(user_id,role,active) values (member_id,member_role,true)
    on conflict(user_id) do update set role = excluded.role, active = true;
  select project_id into original_id from public.projectflow_state where id = 1;
  insert into public.projectflow_project_members(project_id,user_id,can_manage,active,role)
    values (original_id,member_id,false,true,case when member_role='leader' then 'pm' else 'pm_junior' end)
    on conflict(project_id,user_id) do update set can_manage=excluded.can_manage,active=true,role=excluded.role;
end;
$$;
revoke all on function public.projectflow_authorize(text,text) from public, anon, authenticated;
commit;
