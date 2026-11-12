# Activar Web Push

La interfaz está publicada, pero instalar el código no configura Supabase automáticamente.
Los avisos usan Web Push, no SMTP. El usuario debe iniciar sesión y aceptar el permiso
por cada navegador/dispositivo. La pestaña puede estar cerrada; un navegador forzado
a detenerse, permisos retirados o restricciones de batería pueden impedir la recepción.

## Configuración (una vez)

1. Ejecuta `supabase/setup.sql` y luego `supabase/notifications.sql` en SQL Editor.
2. Genera claves VAPID con `npx web-push@3.6.7 generate-vapid-keys` en un computador.
   Pon solamente la **publicKey** en `config.js`, campo `pushPublicKey`.
3. En Supabase → Edge Functions → Secrets configura:
   - `VAPID_PUBLIC_KEY`: esa misma clave pública.
   - `VAPID_PRIVATE_KEY`: clave privada (nunca GitHub ni el chat).
   - `VAPID_SUBJECT`: `mailto:` seguido del correo del administrador.
   - `PUSH_DISPATCH_SECRET`: una cadena aleatoria larga privada para autenticar el envío.
4. Despliega `supabase/functions/push-dispatch/index.ts` como `push-dispatch`.
   Desactiva la verificación JWT del gateway para esta función: el código verifica
   `Authorization: Bearer <PUSH_DISPATCH_SECRET>`. Con CLI:
   `supabase functions deploy push-dispatch --no-verify-jwt`.
5. En Supabase Cron crea una tarea cada minuto que haga POST a
   `https://vhpvyebzypqikozzimmw.supabase.co/functions/v1/push-dispatch`,
   con el encabezado Authorization anterior. Guarda el secreto en Supabase/Vault,
   no en archivos públicos. Se puede añadir un Database Webhook INSERT sobre
   `projectflow_push_queue` al mismo destino para acelerar los avisos; Cron asegura
   los reintentos. El envío procesa 5 eventos por ejecución y reintenta hasta 5 veces.
6. Publica `config.js` y abre Ajustes → Avisos → Activar en este dispositivo.

## Comprobar en Android

Activa desde Chrome, cierra la pestaña y crea una solicitud desde otra cuenta.
El admin global recibe un aviso; al tocarlo abre el proyecto. Prueba también una
mención explícita, desactivar avisos, retirar el rol y salir de sesión.
No se avisa al propio autor. Las menciones eligen una cuenta, no interpretan texto
@alias. Los avisos omiten contenido privado en la pantalla bloqueada. Se revisan
los permisos de nuevo al enviar. Las suscripciones caducadas se retiran.

La cola almacena eventos y estado de envío; los eventos fallidos tras cinco intentos
requieren revisar la función y restablecer attempts/next_at desde administración.
No borres las claves VAPID ni las cambies sin volver a suscribir los dispositivos.
