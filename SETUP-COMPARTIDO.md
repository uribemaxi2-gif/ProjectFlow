# Acceso privado y datos compartidos

## Entrar y trabajar

Abre la dirección habitual de GitHub Pages y entra con la cuenta creada en
**Authentication → Users**. Es la cuenta de ProjectFlow; no tiene por qué ser la
misma contraseña con la que administras el panel de Supabase.

Solo los líderes (`leader`) y responsables (`responsible`) autorizados pueden
consultar o modificar registros. Los permisos se aplican en la base de datos;
ocultar el formulario o conocer la clave pública no permite saltárselos.

Los nombres y los hitos se guardan al modificarlos. La ficha y los registros
se guardan con sus botones. Espera el mensaje **Guardado para el equipo** antes
de cerrar la página. Si falla la conexión, la página lo indica y conserva los
campos para volver a intentar el guardado.

Cada página carga los datos compartidos al abrirse. Mientras está visible,
comprueba cada 30 segundos si hay cambios y muestra un aviso. Pulsa **Actualizar**
para cargarlos. Si dos personas modifican la misma sección, se rechaza el segundo
guardado para evitar sobrescribir cambios: conserva tus cambios, actualiza y
vuelve a aplicarlos. La ficha, solicitudes, revisiones y acuerdos forman una
sección; integrantes e hitos son otras dos secciones independientes.

## Recuperar lo que estaba guardado en un navegador

1. Abre ProjectFlow en el mismo navegador y dirección donde introdujiste los datos.
2. Inicia sesión. Si existen datos de la versión anterior, aparecerá
   **Descargar datos anteriores** en la barra superior.
3. Descarga ese respaldo. No se importa nada automáticamente.
4. En **Datos del proyecto → Ficha del proyecto**, usa **Importar respaldo**.
5. Revisa la confirmación: importar reemplaza los registros compartidos, incluidos
   los integrantes e hitos que contenga el respaldo. Descarga antes el respaldo
   actual si ya hay datos del equipo que debas conservar.

## Configuración inicial en Supabase

1. Crea el proyecto en Supabase.
2. Ejecuta todo [supabase/setup.sql](supabase/setup.sql) desde **SQL Editor**.
   Se puede repetir sin borrar datos ni reactivar cuentas revocadas.
3. En **Authentication → Users → Add user → Create new user**, crea la cuenta
   del líder con correo y contraseña. Activa **Auto Confirm User** si aparece.
   Este alta manual no necesita configurar el envío de correos.
4. Desde **SQL Editor**, autoriza el correo real de esa cuenta:

   ```sql
   select public.projectflow_authorize('lider@ejemplo.com', 'leader');
   ```

5. En `config.js`, completa la URL y la clave **Publishable** del proyecto.
   Estos valores son públicos y están diseñados para el navegador. Nunca uses
   claves `secret`, `service_role`, contraseñas ni tokens de administración.
6. Publica los archivos del repositorio mediante el workflow de GitHub Pages.

El registro público no se ofrece en la aplicación. Aunque alguien obtenga una
cuenta de Supabase por otra vía, no podrá ver datos hasta recibir autorización
en `projectflow_members`. Puedes desactivar los registros nuevos en los ajustes
de Authentication si solo crearás cuentas manualmente.

## Añadir otro líder o responsable

Crea primero su cuenta desde **Authentication → Users**, como en el paso anterior.
Después ejecuta una de estas consultas con su correo real:

```sql
-- Líder:
select public.projectflow_authorize('lider@ejemplo.com', 'leader');

-- Responsable:
select public.projectflow_authorize('responsable@ejemplo.com', 'responsible');
```

La autorización se administra desde Supabase. Las cuentas de la aplicación no
pueden concederse permisos ni autorizar a otras personas por su cuenta.

Para retirar el acceso conservando los registros:

```sql
update public.projectflow_members set active = false
where user_id = (
  select id from auth.users where email = 'persona@ejemplo.com'
);
```

La base bloqueará las siguientes lecturas y escrituras de esa cuenta. Una página
abierta se bloqueará al comprobar los permisos o intentar guardar. Los datos que
alguien haya descargado previamente no se pueden recuperar de su dispositivo.

## Comprobar la publicación

1. Espera a que **Deploy static content to Pages** termine correctamente en Actions.
2. Abre una ventana privada: debe aparecer el inicio de sesión en las tres páginas.
3. Entra con una cuenta autorizada, guarda un nombre y espera la confirmación.
4. En otro navegador, entra con otra cuenta autorizada y comprueba ese nombre.
5. Usa **Salir** al terminar. Si la sesión o el acceso dejan de ser válidos,
   los siguientes accesos a la base deben rechazarse.

Las pruebas automáticas locales no sustituyen esta comprobación contra el proyecto
real. No publiques un cambio de URL o de proyecto sin repetirla.
