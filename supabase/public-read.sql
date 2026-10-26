-- Actualiza la instalación anterior sin borrar datos ni cambiar autorizaciones.
-- Ejecutar completo en Supabase > SQL Editor > Run.
-- Cualquier persona con el enlace podrá leer los datos del proyecto.
-- Solo las cuentas autorizadas podrán agregar, editar, importar o borrar datos.
begin;

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

-- No se abre el acceso a las tablas ni a las funciones de escritura o administración.
commit;
