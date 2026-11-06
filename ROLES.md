# Roles de ProjectFlow

Los roles se asignan **por proyecto**. Una misma cuenta puede ser PM en uno,
Consultor / QA en otro y tener solo lectura en los demás.

| Rol | Leer | Enviar solicitudes e ideas | Gestionar datos | Crear proyectos | Invitar | Cambiar roles y retirar permisos |
| --- | --- | --- | --- | --- | --- | --- |
| Usuario | Sí, sin cuenta | No | No | No | No | No |
| Consultor / QA | Sí | Sí | No | No | No | No |
| PM menor | Sí | Sí | Sí | Sí | No | No |
| PM | Sí | Sí | Sí | Sí | Como Consultor / QA | No |
| Admin | Sí | Sí | Sí | Sí | Con el rol elegido | Sí |

Gestionar datos incluye agenda, semanas, ficha del proyecto, solicitudes,
revisiones, acuerdos y restaurar respaldos. Ajustar el tamaño de letra o copiar el
enlace de lectura sigue disponible para todos.

## Activar los roles en Supabase

1. Abre [el SQL completo actualizado](https://raw.githubusercontent.com/uribemaxi2-gif/ProjectFlow/main/supabase/setup.sql).
2. Copia todo en **Supabase → SQL Editor → New query** y pulsa **Run**.
3. Recarga ProjectFlow. En **⚙ Ajustes → Mi cuenta** aparecerá tu rol.

La actualización conserva los datos, cuentas y permisos retirados:

- Los propietarios anteriores pasan a **Admin**.
- Los editores anteriores pasan a **PM menor**.
- Las invitaciones anteriores conservan el acceso de edición que ofrecían,
  ahora como PM menor. Las nuevas usan los roles elegidos en la web.
- Repetir el SQL no restaura permisos retirados ni deshace roles ya asignados.

Si el envío con Brevo ya funciona, **no hay que volver a configurar el correo**.
Este SQL no modifica SMTP, contraseñas ni plantillas de Supabase Auth.
La web mantiene el acceso anterior hasta que se ejecute la actualización.

## Administrar cuentas

Como admin, selecciona el proyecto y abre
**⚙ Ajustes → Proyecto y enlace → Roles e invitaciones**.

Para invitar, escribe el correo y elige **Rol al aceptar**. La persona verá el rol
y sus permisos antes de aceptar. La opción inicial es Consultor / QA.
Para cambiar un rol ya aceptado, busca la cuenta, elige el nuevo nivel y pulsa
**Guardar rol**. Solo se modifica ese proyecto.

**Usuario · Solo lectura** permite mantener una cuenta en el proyecto sin que
pueda agregar o modificar datos. También se puede leer sin iniciar sesión.
**Quitar permiso** retira la participación de esa cuenta; la lectura pública
permanece disponible. Los cambios de rol y las revocaciones invalidan invitaciones
anteriores de esa cuenta para que no recuperen un permiso antiguo.

No se puede retirar ni rebajar al último admin del proyecto. Primero debe haber
otro admin activo. Un admin puede cambiar su propio nivel si existe otro; la web
le pedirá actualizar su acceso después del cambio.

## Invitaciones del PM

El PM dispone de **Invitar personas** en los ajustes. Sus invitaciones son siempre
para **Consultor / QA**, sin selector de roles. Puede ver, reenviar y cancelar
sus propias invitaciones pendientes. No administra invitaciones ajenas, no cambia
roles existentes y no puede restablecer permisos que un admin haya retirado.

El destinatario verifica su correo, crea su contraseña si es nuevo y acepta.
Un admin puede ascenderlo después. Si quien envió una invitación pendiente pierde
el permiso necesario, esa invitación no podrá aceptarse mientras no lo recupere.

## Solicitudes de Consultor / QA

En **Mi proyecto → Solicitudes**, pulsa **Nueva tarea** y describe la solicitud,
idea o error. Puedes sugerir prioridad y fecha e indicar un enlace relacionado.
La solicitud entra como **Pendiente**, con identidad y fecha registradas por el
servidor. Un PM menor, PM o admin gestiona su evaluación y estado.

QA puede consultar los detalles de todos los registros, pero no editarlos,
eliminarlos, aprobarlos ni modificar la agenda, el plan, la ficha o los respaldos.
Si falla la respuesta al enviar, el formulario conserva lo escrito. Reintentar
la misma solicitud no crea una segunda copia.

## Proyectos creados por PM menor o PM

Al pulsar **Nuevo proyecto**, el creador conserva su nivel de PM menor o PM.
Los admins del proyecto seleccionado quedan como admins del nuevo proyecto.
Los demás participantes no se copian. Así, crear un proyecto no permite al PM
ascenderse ni concederse permisos para administrar roles.

Un admin que crea un proyecto queda como admin de ese proyecto.

## Verificación y límites

La autorización se comprueba en funciones de PostgreSQL, además de mostrar las
acciones correspondientes en la web. Cambiar HTML o llamar directamente a las
funciones desde la consola no concede permisos adicionales. Las tablas de roles,
invitaciones y recibos de solicitudes no son accesibles directamente desde la web.

Cada escritura comprueba los permisos actuales. Las pestañas abiertas revisan
cambios de rol cada 30 segundos mientras están visibles; si el rol cambia, piden
actualizar el acceso. Los controles que todavía se vean antes de actualizar no permiten
evitar la comprobación en la base de datos.

`npm test` comprueba los roles, la migración, el aislamiento entre proyectos,
invitaciones y solicitudes. `npm run test:browser` verifica las pantallas,
el móvil, la lectura pública y los reintentos. Son pruebas locales con Supabase
simulado para el navegador; no envían correos reales ni actualizan tu base remota.
