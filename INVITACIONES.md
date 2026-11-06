# Activar invitaciones por correo

La web permite invitar a participar en un proyecto concreto con un [rol asignado](ROLES.md). Quien recibe la invitación
verifica su correo y acepta el acceso; si es nuevo, crea su propia contraseña.
No tienes que conocerla ni crear su cuenta manualmente. Los demás mantienen el
acceso de lectura con el enlace del proyecto.

Estos pasos se hacen una vez en Supabase y tu proveedor de correo. Si Brevo ya está funcionando, actualizar los roles solo requiere ejecutar el SQL; conserva el SMTP actual. Subir la web a GitHub no los
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

## 3. Preparar Brevo

1. Crea tu cuenta en [Brevo](https://www.brevo.com/).
2. Agrega y verifica el correo remitente desde **Configuración → Remitentes**.
3. Abre **SMTP y API → SMTP**. Copia el **Login SMTP** y genera una **clave SMTP**.

El login SMTP puede ser una dirección terminada en `@smtp-brevo.com`: no es
necesariamente tu correo remitente. La clave SMTP es diferente de una clave API
o de la contraseña con la que entras al panel de Brevo. Guárdala de forma privada.

## 4. Conectar Brevo a Supabase

En **Authentication → Email → SMTP Settings**, activa **Enable Custom SMTP**:

| Campo | Valor |
| --- | --- |
| Sender email address | El correo remitente verificado en Brevo |
| Sender name | ProjectFlow |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | El Login SMTP que muestra Brevo |
| Password | La clave SMTP generada en Brevo |

Guarda los cambios. No compartas claves por chat, capturas, GitHub ni archivos de
la web. Si pierdes la clave, genera otra y reemplázala directamente en Supabase.
El correo integrado de Supabase tiene restricciones de destinatarios y no
sustituye el SMTP para invitar a personas ajenas al equipo de Supabase.

Otros proveedores SMTP también son compatibles. Cambiar de proveedor no requiere
modificar los roles, las cuentas ni el código de ProjectFlow.

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

1. Entra como admin o PM y selecciona el proyecto.
2. Abre **⚙ Ajustes → Proyecto y enlace → Roles e invitaciones** (admin) o **Invitar personas** (PM).
3. Escribe el correo. El admin elige el rol; el PM siempre invita como Consultor / QA. Pulsa **Enviar invitación**.
4. La persona abre el correo, elige su contraseña si es nueva y pulsa
   **Aceptar invitación**. Puede hacerlo desde otro dispositivo o navegador.
5. Comprueba que aparece en **Personas con acceso** de ese proyecto.

El remitente conserva su sesión. El destinatario conserva su contraseña si ya tenía
cuenta y recibe únicamente el rol indicado en la invitación para ese proyecto.
Después podrá entrar con su correo y contraseña desde los ajustes de la web.

**Reenviar** crea un enlace nuevo e invalida la invitación anterior; espera al menos
un minuto entre intentos al mismo correo. Una invitación pendiente dura siete días,
pero el enlace de acceso del correo vence antes, según la caducidad configurada en
Supabase Auth. Si vence, reenvía la invitación. Si ya tiene sesión o contraseña,
puede entrar en la pantalla de invitación mientras esta siga vigente.

**Cancelar invitación** impide aceptarla. Si ya la aceptó, el admin usa **Quitar permiso**;
volver a abrir el correo anterior no recupera el permiso retirado. La lectura
continúa disponible con el enlace público del proyecto.

## Si algo falla

- **«Las invitaciones aún no están activadas»**: ejecuta todo el SQL del paso 1
  y recarga. Los permisos existentes siguen funcionando.
- **«No se pudo enviar el correo»**: revisa los campos SMTP, la clave
  SMTP y **Logs → Log type: Auth**. Abre el evento `/otp` y consulta `error` en Raw JSON. La invitación queda pendiente y puedes
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
