# ProjectFlow

Varios proyectos compartidos, cada uno con agenda, fechas de entrega, semanas de
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
(activación por dispositivo; requiere configurar Supabase), **Seguridad** (contraseña) y **Datos** (proyectos, roles, invitaciones y enlace).
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

El resumen de **Proyecto** permite crear solicitudes y revisiones directamente.
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
Para una instalación nueva, crea la primera cuenta en **Supabase → Authentication →
Users → Add user → Create new user**, activa **Auto Confirm User** y autorízala en
SQL Editor:

```sql
select public.projectflow_authorize('mi-correo@ejemplo.com', 'leader');
```

`config.js` contiene solo la URL y la clave pública Publishable. Nunca pongas ahí
contraseñas, claves secretas ni `service_role`.

## Proyectos, semanas y respaldos

En **Ajustes → Datos → + Nuevo proyecto** indica el nombre, fechas opcionales y
semanas iniciales (1–104). **Cambiar de proyecto** abre la lista de proyectos a los
que tienes acceso. Cada uno mantiene su propia agenda, ficha y registros.

En **Agenda**, cada actividad tiene fecha, estado y una semana opcional. Se admiten
hasta 500 actividades por proyecto. **Plan semanal** permite añadir o quitar
semanas, cambiar fechas y objetivos y marcar semanas de reserva, que no cuentan en
el progreso. Eliminar una semana conserva sus tareas y fechas, dejándolas sin semana.
Las fechas de la ficha, semanas y tareas son independientes: no se reprograman solas.

**Ajustes → Datos → Copiar enlace de lectura** comparte solo el proyecto seleccionado.
Cualquier persona con ese enlace puede leerlo sin cuenta. **Usuarios** administra
las invitaciones y permisos según el rol; autorizar un proyecto no autoriza los demás,
salvo el acceso global de Admin.

La agenda y el plan guardan automáticamente; ficha y registros usan sus botones.
Espera la confirmación de guardado. La lectura se actualiza cada 30 segundos con la
página visible. Los editores reciben un aviso para recargar; si dos personas cambian
la misma sección, se rechaza el guardado obsoleto para evitar sobrescrituras.

**Proyecto → Ficha del proyecto → Descargar PDF** genera un documento A4 con la
ficha, agenda, semanas, solicitudes, revisiones, acuerdos e historial del proyecto
seleccionado. El botón al pie de la página también descarga el PDF. Incluye textos
completos y páginas numeradas; no depende del tema ni de los filtros de pantalla.
Se genera en el navegador con los datos cargados, sin subirlos a otro servicio.

El PDF es para consultar o compartir. **Restaurar datos del proyecto (JSON)** agrupa
la descarga e importación de la copia que permite restaurar datos en la aplicación.
Los respaldos JSON incluyen agenda, semanas, ficha y registros del proyecto seleccionado.
Importarlos reemplaza esos datos, sin modificar otros proyectos ni sus permisos.
Descarga una copia antes de importar. Los respaldos antiguos siguen siendo compatibles;
las asignaciones anteriores permanecen en **Agenda → Datos conservados del proyecto anterior**.
Para rescatar información local antigua, usa **Ajustes → Datos → Descargar datos anteriores**
si aparece y luego importa el archivo en el proyecto correspondiente.

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

Sitio estático sin compilación. Las bibliotecas Supabase y jsPDF están incluidas en `assets/vendor`, con sus licencias.
`npm run vendor` las reproduce desde las dependencias fijadas en el lockfile y descarga
la fuente Noto Sans desde una revisión fija de su repositorio oficial. En Node 24 con
proxy, usa `NODE_USE_ENV_PROXY=1 npm run vendor`. jsPDF y la fuente solo se cargan
cuando se solicita un PDF; la navegación habitual no descarga esos archivos.
Las pruebas SQL usan PostgreSQL mediante PGlite. Las de navegador usan Python,
Playwright y Chromium en `/usr/bin/chromium`, con una API de Supabase simulada.
Las pruebas de descarga PDF usan `pdftotext` para comprobar el contenido y la paginación.
No escriben en Supabase real ni envían correos.

GitHub Pages publica únicamente las cuatro páginas HTML, `config.js` y `assets/`.
La documentación, SQL, pruebas y herramientas permanecen en GitHub, fuera del sitio
publicado. No hay compilación: el workflow prepara una carpeta temporal de publicación.

Para recuperar la contraseña, abre el inicio de sesión, escribe el correo y pulsa
**¿Has olvidado tu contraseña?**. El correo de Supabase devuelve a `index.html`
y abre el formulario para elegir una contraseña nueva. Usa el mismo remitente SMTP
y la URL de retorno que el acceso por correo; no crea cuentas ni concede permisos.

Las notificaciones Web Push requieren [la configuración de servidor](NOTIFICACIONES.md).
La clave privada VAPID y el secreto de envío nunca se publican en GitHub.
