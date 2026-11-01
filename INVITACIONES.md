# Activar invitaciones por correo

La web permite invitar a editar un proyecto concreto. Quien recibe la invitación
verifica su correo y acepta el acceso; si es nuevo, crea su propia contraseña.
No tienes que conocerla ni crear su cuenta manualmente. Los demás mantienen el
acceso de lectura con el enlace del proyecto.

Estos pasos se hacen una vez en Supabase y Google. Subir la web a GitHub no los
configura automáticamente. No hace falta mantener abierto el PC ni Supabase.

## 1. Actualizar la base de datos

Abre [el SQL completo](https://raw.githubusercontent.com/uribemaxi2-gif/ProjectFlow/main/supabase/setup.sql),
cópialo entero y ejecútalo en **Supabase → SQL Editor → New query → Run**.
Conserva los datos y permisos existentes. Espera a que termine correctamente.

## 2. Configurar la dirección de retorno

En **Authentication → URL Configuration**:

- **Site URL**: `https://uribemaxi2-gif.github.io/ProjectFlow/`
- Agrega en **Redirect URLs**: `https://uribemaxi2-gif.github.io/ProjectFlow/**`

Guarda los cambios. El sufijo `/**` permite volver a la pantalla de invitación
con su identificador. Si cambia la dirección de la web, actualiza estos campos.

En **Authentication → Sign In / Providers**, comprueba que **Email** esté activo,
que se permitan usuarios nuevos (**Allow new users to sign up**) y que
**Confirm email** esté activado. La confirmación del correo es necesaria para
verificar que la persona controla la dirección invitada. No la desactives para
solucionar errores de envío.

## 3. Preparar Gmail

1. Abre [Seguridad de tu cuenta de Google](https://myaccount.google.com/security).
2. Activa **Verificación en dos pasos** si todavía no está activada.
3. Abre [Contraseñas de aplicaciones](https://myaccount.google.com/apppasswords).
4. Crea una con el nombre **ProjectFlow**. Google mostrará una contraseña de
   aplicación; la introducirás directamente en Supabase en el siguiente paso.

No uses tu contraseña habitual de Gmail. No compartas la contraseña de aplicación
por chat, capturas, GitHub ni archivos de la web. Si Google no ofrece esta opción
para tu cuenta, habrá que usar otro proveedor SMTP; depende de las políticas y
opciones de seguridad de esa cuenta.

## 4. Conectar Gmail a Supabase

Busca **Authentication → Email → SMTP Settings** (en algunas versiones aparece
como **Emails** o **Custom SMTP**) y activa **Enable Custom SMTP**.

| Campo | Valor |
| --- | --- |
| Sender email address | Tu dirección completa de Gmail |
| Sender name | ProjectFlow |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | La misma dirección completa de Gmail |
| Password | La contraseña de aplicación generada por Google |

Guarda los cambios. Gmail sirve para comenzar con pocos envíos; Google y Supabase
aplican límites. Si el uso aumenta, se puede cambiar a un proveedor de correo
transaccional sin cambiar los permisos ni las cuentas de ProjectFlow.

El correo integrado de Supabase tiene restricciones de destinatarios; no sustituye
este SMTP para invitar a personas ajenas al equipo de Supabase.

## 5. Revisar el mensaje del correo

En las plantillas de **Authentication → Email**, revisa **Confirm signup** y
**Magic Link**. La primera se usa para cuentas nuevas y la segunda para existentes.
Ambas deben conservar un enlace con `{{ .ConfirmationURL }}`: verifica el correo
antes de regresar a ProjectFlow. No lo reemplaces por el enlace directo de lectura
ni por `{{ .SiteURL }}` o `{{ .RedirectTo }}`.

Puedes usar en ambas el asunto **Tu acceso a ProjectFlow** y este contenido:

```html
<h2>Tu acceso a ProjectFlow</h2>
<p>Confirma tu correo para continuar. Si recibiste una invitación a un proyecto,
podrás revisarla y aceptarla en el siguiente paso.</p>
<p><a href="{{ .ConfirmationURL }}">Continuar en ProjectFlow</a></p>
<p>Si no esperabas este mensaje, puedes ignorarlo.</p>
```

Estas plantillas también pueden usarse para otros accesos por correo de Supabase;
el permiso de edición se valida por separado al aceptar la invitación.

## 6. Invitar desde ProjectFlow

1. Entra como propietario y selecciona el proyecto.
2. Abre **⚙ Ajustes → Proyecto y enlace → Quién puede editar**.
3. Escribe el correo de la persona y pulsa **Enviar invitación**.
4. La persona abre el correo, elige su contraseña si es nueva y pulsa
   **Aceptar invitación**. Puede hacerlo desde otro dispositivo o navegador.
5. Comprueba que aparece en **Personas con acceso** de ese proyecto.

El remitente conserva su sesión. El destinatario conserva su contraseña si ya tenía
cuenta y no obtiene permisos de propietario ni acceso de edición a otros proyectos.
Después podrá entrar con su correo y contraseña desde los ajustes de la web.

**Reenviar** crea un enlace nuevo e invalida la invitación anterior; espera al menos
un minuto entre intentos al mismo correo. Una invitación pendiente dura siete días,
pero el enlace de acceso del correo vence antes, según la caducidad configurada en
Supabase Auth. Si vence, reenvía la invitación. Si ya tiene sesión o contraseña,
puede entrar en la pantalla de invitación mientras esta siga vigente.

**Cancelar invitación** impide aceptarla. Si ya la aceptó, usa **Quitar permiso**;
volver a abrir el correo anterior no recupera el permiso retirado. La lectura
continúa disponible con el enlace público del proyecto.

## Si algo falla

- **«Las invitaciones aún no están activadas»**: ejecuta todo el SQL del paso 1
  y recarga. Los permisos existentes siguen funcionando.
- **«No se pudo enviar el correo»**: revisa los campos SMTP, la contraseña de
  aplicación y **Authentication → Logs**. La invitación queda pendiente y puedes
  reenviarla después. Todavía no concede acceso.
- **Límite de envíos**: espera el tiempo indicado y revisa los límites de Auth y
  del proveedor. No reintentes continuamente.
- **Dice enviada pero no llega**: revisa Spam y los registros de correo de Auth.
  «Enviada» indica que Supabase aceptó la solicitud, no confirma su entrega.
- **Vuelve al inicio sin mostrar la invitación**: revisa Redirect URLs y el
  enlace `{{ .ConfirmationURL }}` de ambas plantillas.
- **No corresponde a tu cuenta**: pulsa **Usar otra cuenta** y utiliza exactamente
  el correo al que se envió la invitación.

## Comprobación técnica

`npm test` valida los permisos con PostgreSQL: confirmación y coincidencia de
correo, caducidad, revocación, aceptación, aislamiento por proyecto y repetición
de la migración. `npm run test:browser` usa Supabase simulado para comprobar
envío, errores, contraseña del destinatario, móvil y conservación de la sesión.
No envían correos reales. Después de configurar SMTP hay que comprobar una
invitación real con un destinatario acordado.

La web utiliza la clave pública de Supabase. Las tablas de invitaciones y permisos
tienen RLS y no son accesibles directamente; las funciones de base de datos
comprueban al propietario y al destinatario. El endpoint público de autenticación
permite verificar correos, pero crear una cuenta por sí solo no concede edición.
Ninguna clave administrativa ni credencial SMTP debe incorporarse al frontend.
