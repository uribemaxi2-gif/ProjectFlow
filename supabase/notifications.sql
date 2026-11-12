-- Ejecutar después de setup.sql. No habilita envíos hasta configurar la función.
begin;
create table if not exists public.projectflow_push_subscriptions (
 endpoint text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.projectflow_push_queue (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 project_id uuid not null references public.projectflow_state(project_id) on delete cascade,
 kind text not null, created_at timestamptz not null default now(), sent_at timestamptz,
 attempts integer not null default 0, next_at timestamptz not null default now()
);
alter table public.projectflow_push_subscriptions enable row level security;
alter table public.projectflow_push_queue enable row level security;
revoke all on public.projectflow_push_subscriptions,public.projectflow_push_queue from public,anon,authenticated;
create index if not exists projectflow_push_pending on public.projectflow_push_queue(next_at) where sent_at is null;
create or replace function public.projectflow_push_subscribe(p_subscription jsonb,p_enabled boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare v_endpoint text:=p_subscription->>'endpoint';
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
 if v_endpoint is null or length(v_endpoint)>2048 or v_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com)/' then raise exception 'Servicio push no compatible.'; end if;
 if not p_enabled then delete from public.projectflow_push_subscriptions where user_id=auth.uid() and projectflow_push_subscriptions.endpoint=v_endpoint; return; end if;
 if coalesce(p_subscription#>>'{keys,p256dh}','') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_subscription#>>'{keys,auth}','') !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Suscripción inválida.'; end if;
 if (select count(*) from public.projectflow_push_subscriptions where user_id=auth.uid())>=20 and not exists(select 1 from public.projectflow_push_subscriptions s where s.endpoint=v_endpoint) then raise exception 'Máximo de dispositivos alcanzado.'; end if;
 insert into public.projectflow_push_subscriptions values(v_endpoint,auth.uid(),p_subscription,now()) on conflict(endpoint) do update set user_id=excluded.user_id,subscription=excluded.subscription,updated_at=now();
end;$$;
revoke all on function public.projectflow_push_subscribe(jsonb,boolean) from public,anon;
grant execute on function public.projectflow_push_subscribe(jsonb,boolean) to authenticated;
create or replace function public.projectflow_mention_targets(p_project_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if public.projectflow_role(p_project_id) not in ('qa','pm_junior','pm','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(public.projectflow_display_name(u.id),'Sin alias'),'role',public.projectflow_user_role(p_project_id,u.id)) order by u.id),'[]') from auth.users u where public.projectflow_user_role(p_project_id,u.id) in ('qa','pm_junior','pm','admin'));
end;$$;
revoke all on function public.projectflow_mention_targets(uuid) from public,anon;
grant execute on function public.projectflow_mention_targets(uuid) to authenticated;
create or replace function public.projectflow_queue_notifications()
returns trigger language plpgsql security definer set search_path='' as $$
declare category text; entry jsonb; previous jsonb; target uuid; previous_data jsonb;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='INSERT' then previous_data:='{}'; else previous_data:=old.data; end if;
 foreach category in array array['requests','reviews','agreements'] loop
  for entry in select value from jsonb_array_elements(case when jsonb_typeof(new.data#>array['projecthub.cliente.v1',category])='array' then new.data#>array['projecthub.cliente.v1',category] else '[]'::jsonb end) loop
   select value into previous from jsonb_array_elements(case when jsonb_typeof(previous_data#>array['projecthub.cliente.v1',category])='array' then previous_data#>array['projecthub.cliente.v1',category] else '[]'::jsonb end) where value->>'id'=entry->>'id' limit 1;
   if previous is null then
    insert into public.projectflow_push_queue(user_id,project_id,kind) select user_id,new.project_id,'created' from public.projectflow_global_admins where active and user_id<>auth.uid();
   end if;
   if coalesce(entry->>'mentionId','') ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' and (entry->>'mentionId') is distinct from (previous->>'mentionId') then
    target:=(entry->>'mentionId')::uuid;
    if target<>auth.uid() and public.projectflow_user_role(new.project_id,target) in ('qa','pm_junior','pm','admin') then
     insert into public.projectflow_push_queue(user_id,project_id,kind) values(target,new.project_id,'mention');
    end if;
   end if;
  end loop;
 end loop;
 return new;
end;$$;
revoke all on function public.projectflow_queue_notifications() from public,anon,authenticated;
drop trigger if exists projectflow_notify on public.projectflow_state;
create trigger projectflow_notify after insert or update of data on public.projectflow_state for each row execute function public.projectflow_queue_notifications();
-- Claim rows for a short lease so concurrent dispatches do not send them together.
create or replace function public.projectflow_claim_push()
returns setof public.projectflow_push_queue language sql security definer set search_path='' as $$
 update public.projectflow_push_queue set attempts=attempts+1,next_at=now()+interval '5 minutes'
 where id in (select id from public.projectflow_push_queue where sent_at is null and attempts<5 and next_at<=now() order by created_at for update skip locked limit 5) returning *;
$$;
revoke all on function public.projectflow_claim_push() from public,anon,authenticated;
-- Supabase provides service_role; test installations can omit these grants.
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant all on public.projectflow_push_subscriptions,public.projectflow_push_queue to service_role;
 grant execute on function public.projectflow_claim_push() to service_role;
 grant execute on function public.projectflow_user_role(uuid,uuid) to service_role;
end if;end$$;
commit;
