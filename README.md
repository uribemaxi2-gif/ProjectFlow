# ProjectFlow

Varios proyectos personales, cada uno con agenda, fechas de entrega, semanas de
trabajo, ficha y registros independientes. Un selector cambia entre los proyectos
a los que tienes acceso de edición; cada proyecto tiene su propio enlace de lectura.

- `index.html`: actividades con fecha, semana asignada y estado.
- `cronograma.html`: semanas editables, objetivos, fechas y progreso.
- `proyecto.html`: ficha, solicitudes y tareas, revisiones, notas y respaldos.
- `assets/projects.js`: crear proyectos, compartir enlaces y administrar editores.

El propietario puede crear proyectos y autorizar editores **por proyecto**. Conocer
el enlace permite consultar ese proyecto, sin conceder edición ni mostrar el catálogo
personal. Las cuentas colaboradoras se crean una vez en Supabase Authentication.

El menú se abre y cierra con **Abrir menú / Cerrar menú**. En celular y tablet
comienza cerrado; al elegir una sección deja libre la pantalla. En PC puedes
ocultarlo para ampliar el contenido. **Texto grande** aumenta la letra; ambas
preferencias se guardan solo en ese navegador. También se respeta el zoom del
navegador. El menú móvil admite teclado, Escape y cierre al tocar fuera.

## Configurar o actualizar

Ejecuta **todo** [supabase/setup.sql](supabase/setup.sql) en el SQL Editor de Supabase.
Sirve para instalaciones nuevas y actualiza las versiones de un único proyecto,
incluida la versión privada. Conserva el proyecto original y sus autorizaciones.
No hace falta ejecutar primero `public-read.sql`; ese archivo corresponde a la
actualización anterior de lectura pública.

[Guía de uso, permisos y actualización](SETUP-COMPARTIDO.md).

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
