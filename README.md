# ProjectFlow

Varios proyectos personales, cada uno con agenda, fechas de entrega, semanas de
trabajo, ficha y registros independientes. Un selector cambia entre los proyectos
a los que tienes acceso con tu cuenta; cada proyecto tiene su propio enlace de lectura.

- `index.html`: actividades con fecha, semana asignada y estado.
- `cronograma.html`: semanas editables, objetivos, fechas y progreso.
- `proyecto.html`: ficha, solicitudes y tareas, revisiones, notas y respaldos.
- `assets/projects.js`: crear proyectos, compartir enlaces y administrar editores.

Hay cinco [roles](ROLES.md): Usuario (lectura sin cuenta),
Consultor / QA (envía solicitudes), PM menor (gestiona datos), PM (administra su proyecto y asigna roles inferiores) y Admin global
(administra toda la web, todos los proyectos y puede nombrar otros admins). Las invitaciones verifican
el correo y permiten crear una contraseña personal. Conocer el enlace solo permite
consultar ese proyecto, sin mostrar el catálogo personal.

El menú se abre y cierra con el icono **☰**. En celular y tablet
comienza cerrado; al elegir una sección deja libre la pantalla. En PC puedes
ocultarlo para ampliar el contenido. El menú móvil admite teclado, Escape y cierre
al tocar fuera. **⚙ Ajustes** abre una pantalla propia con **Cuenta** (alias y correo), **Apariencia** (tema y siete tamaños), **Avisos**
(en preparación), **Seguridad** (contraseña) y **Datos** (proyectos, roles, invitaciones y enlace).
El tema puede ser claro, oscuro o seguir el sistema y se conserva en este navegador. El botón **Volver** y el botón Atrás del
navegador regresan al proyecto sin perder formularios pendientes de guardar.
El nombre del proyecto y el estado de guardado siguen visibles.
En **Seguridad → Cambiar contraseña**, cada persona con sesión puede
definir su propia contraseña para volver a entrar con su correo, incluidos quienes
aceptaron anteriormente una invitación sin haber elegido contraseña.

**Tamaño de letra** tiene siete niveles, con aplicación inmediata
a toda la web. Son 87,5 %, 93,75 %, 100 %, 112,5 %, 125 %, 137,5 % y 150 % del
tamaño base del navegador (14, 15, 16, 18, 20, 22 y 24 px con la base habitual).
El nivel 3 es el predeterminado y **Restablecer tamaño** vuelve a él. La preferencia
se guarda en este navegador; no modifica los datos compartidos ni las preferencias
de otras personas. El antiguo **Texto grande** se conserva como nivel 5. También
se respeta el zoom y el tamaño base que la persona configure en su navegador.

El resumen de **Mi proyecto** permite crear solicitudes y revisiones directamente.
Las tarjetas muestran título, rol de quien creó el registro, descripción y urgencia.
Las solicitudes conservan su campo Prioridad y las revisiones incluyen Urgencia.
El formulario muestra el rango del creador como dato automático, también para Admin.
El rol y el estado aparecen a la derecha y las acciones al pie de las tarjetas.
Las solicitudes permiten seleccionar un responsable (o «Sin asignar»), separado
del solicitante. PM menor, PM y Admin eligen entre participantes activos del proyecto
con rol QA o superior; QA envía solicitudes sin asignar responsables.
El selector muestra el alias; usa el correo para distinguir cuentas sin alias o con
nombres repetidos. La tarjeta pública muestra el alias actual, sin publicar el correo.
La base valida la asignación y guarda un nombre de referencia para respaldos. Para activar el selector, ejecuta
`supabase/setup.sql`; sin esa actualización se pueden conservar los datos actuales.
El rol se conserva tal como era al crear el registro; los anteriores sin ese dato
muestran «Cargo no registrado». Para registrar el rol en nuevas solicitudes de QA,
se necesita ejecutar el SQL actualizado; el servidor obtiene ese rol de la cuenta.

## Nombre o alias

Al aceptar una invitación, la persona elige un nombre o alias de 1 a 60 caracteres.
Se guarda en su cuenta de Supabase Auth (`user_metadata.display_name`), separado de
sus roles, correo y contraseña. En Ajustes → Cuenta, el alias encabeza el perfil y puede
modificarse en **Cambiar alias → Guardar cambios**. Las cuentas anteriores pueden
hacerlo sin una nueva invitación. El correo sigue siendo el identificador de acceso.

Los responsables se muestran por su alias actual, incluso en solicitudes existentes.
Las listas de gestión incluyen el alias y el correo para identificar la cuenta;
los enlaces públicos no revelan esos correos. Si no hay alias se muestra «Sin alias».
Los nombres pueden repetirse y nunca conceden permisos. El nombre del solicitante se
rellena inicialmente con el alias, pero sigue pudiendo indicarse otro solicitante.
Actualizar el SQL activa los alias en responsables y listas de participantes; elegir
el alias en la invitación o en Ajustes usa directamente Supabase Auth.

## Configurar o actualizar

Ejecuta **todo** [supabase/setup.sql](supabase/setup.sql) en el SQL Editor de Supabase.
Sirve para instalaciones nuevas y actualiza las versiones de un único proyecto,
incluida la versión privada. Conserva el proyecto original y sus autorizaciones.
No hace falta ejecutar primero `public-read.sql`; ese archivo corresponde a la
actualización anterior de lectura pública.

[Guía de uso, permisos y actualización](SETUP-COMPARTIDO.md).

Para activar el envío, sigue [Invitaciones por correo](INVITACIONES.md):
requiere actualizar el SQL y configurar el correo SMTP y las redirecciones de
Supabase. Publicar los archivos en GitHub Pages no configura esos servicios.

## Desarrollo

```sh
npm ci --cache /tmp/projectflow-npm --ignore-scripts
python3 -m http.server 8000 --bind 127.0.0.1
npm test
npm run test:browser
```

Sitio estático sin compilación. El SDK de Supabase está incluido en `assets/vendor`;
`npm run vendor` lo reproduce desde la dependencia fijada en el lockfile.
Las pruebas SQL usan PostgreSQL mediante PGlite. Las de navegador usan Python,
Playwright y Chromium en `/usr/bin/chromium`, con una API de Supabase simulada.
No escriben en Supabase real ni envían correos.

Para recuperar la contraseña, abre el inicio de sesión, escribe el correo y pulsa
**¿Has olvidado tu contraseña?**. El correo de Supabase devuelve a `index.html`
y abre el formulario para elegir una contraseña nueva. Usa el mismo remitente SMTP
y la URL de retorno que el acceso por correo; no crea cuentas ni concede permisos.
