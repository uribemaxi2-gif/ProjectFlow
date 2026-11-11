# Roles de ProjectFlow

**Admin global** administra toda la web y todos los proyectos existentes y futuros.
**PM** administra solo los proyectos donde tiene ese rol y únicamente puede asignar
roles inferiores: Usuario, Consultor / QA y PM menor. No modifica a otros PM,
admins ni su propio rol. Solo un Admin global puede nombrar otro Admin global.

| Rol | Alcance | Datos | Invitaciones y roles |
| --- | --- | --- | --- |
| Usuario | Lectura con enlace, sin cuenta | Solo lectura | No |
| Consultor / QA | Proyectos asignados | Leer y enviar solicitudes, ideas o errores | No |
| PM menor | Proyectos asignados | Gestionar agenda, plan, ficha, tareas, revisiones, acuerdos y respaldos; crear proyectos | No |
| PM | Proyectos asignados | Gestión completa y creación de proyectos | Invitar, cambiar y retirar únicamente roles inferiores |
| Admin global | Todos los proyectos | Gestión completa | Todos los roles, incluidos otros admins globales |

El enlace público sigue permitiendo leer sin cuenta. Retirar la participación no
retira la lectura pública. Las preferencias de apariencia están disponibles para todos.

## Activar la actualización

1. Copia todo [supabase/setup.sql](https://raw.githubusercontent.com/uribemaxi2-gif/ProjectFlow/main/supabase/setup.sql).
2. En Supabase abre **SQL Editor → New query**, pega y pulsa **Run**.
3. Recarga ProjectFlow. **Ajustes → Datos** muestra el rol y
   **Ajustes → Datos → Usuarios** permite gestionarlo.

Publicar la web no ejecuta el SQL remoto. Hasta ejecutarlo, se mantienen los
permisos anteriores y la web muestra un aviso de actualización.
No hay que reconfigurar Brevo, SMTP ni las contraseñas.

La migración conserva los datos y convierte los admins activos anteriores en
admins globales. Sus participaciones locales quedan como PM. Los demás roles y
permisos retirados se conservan. Las invitaciones pendientes antiguas que ofrecían
Admin local pasan a PM para no conceder acceso global sin una nueva decisión.
Repetir el SQL no restaura una administración global retirada.

## Administrar personas

Selecciona el proyecto y abre **Usuarios**. Para invitar, escribe el
correo y elige **Rol al aceptar**. Para cambiar una participación aceptada,
selecciona el rol junto a la persona y pulsa **Guardar rol**.

El selector del PM solo ofrece Usuario, Consultor / QA y PM menor. Los PM y admins
aparecen en la lista sin controles de modificación para él. Puede gestionar las
invitaciones de roles inferiores del proyecto, incluso si las preparó otro gestor.
Las invitaciones de PM o Admin global quedan reservadas al Admin global.

Asignar **Admin global** da acceso a toda la web, no solo al proyecto seleccionado.
Todos los admins globales aparecen en las listas de acceso, aunque no tengan una
participación local en ese proyecto. El selector de proyectos de un Admin muestra
todos los proyectos, sin necesitar invitación.

Al cambiar un Admin global a un rol inferior, pierde la administración global y
recibe el rol seleccionado en el proyecto actual; conserva sus participaciones
locales en los demás. **Retirar Admin global** también retira su participación en
el proyecto actual. La web debe conservar al menos un Admin global: primero nombra
a otro antes de retirar o rebajar al último.

Los cambios de rol invalidan las invitaciones anteriores del destinatario en ese
proyecto. Retirar la administración global invalida sus invitaciones de acceso en
toda la web. Cada aceptación vuelve a comprobar los permisos actuales del remitente.

## Solicitudes y creación de proyectos

QA envía solicitudes desde **Mi proyecto → Solicitudes → Nueva tarea**. El servidor
registra autor, fecha y estado Pendiente. QA no edita ni elimina registros, no
aprueba solicitudes y no modifica la agenda, el plan o la ficha. Reintentar el mismo
envío no duplica la solicitud.

Al crear un proyecto, PM y PM menor conservan su nivel. No se copian otros
participantes. Los admins globales tienen acceso automático a ese proyecto nuevo.

## Verificación

Los permisos se validan en PostgreSQL además de los controles de la interfaz.
Las tablas de permisos, admins globales e invitaciones no son accesibles directamente
desde el navegador. Las modificaciones de permisos se serializan para proteger la
jerarquía y al último admin global. Cada escritura valida el acceso actual.
Las pestañas visibles revisan los cambios de rol aproximadamente cada 30 segundos.

`npm test` verifica SQL, migración, jerarquía, aislamiento e invitaciones.
`npm run test:browser` verifica la interfaz con Supabase simulado, sin enviar correos
reales ni modificar la base remota.
