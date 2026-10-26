# ProjectFlow

Espacio personal con agenda por fechas, plan semanal y ficha del proyecto.
Cualquier persona con el enlace puede consultar los datos. Solo el propietario
y las cuentas autorizadas pueden agregar, editar, importar o eliminar información.

- `index.html`: actividades personales con fecha y estado de avance.
- `cronograma.html`: plan de cuatro semanas más una de reserva, con hitos compartidos.
- `proyecto.html`: ficha, solicitudes y tareas, revisiones, acuerdos, notas y respaldos.

Las fechas y actividades sustituyen al equipo fijo de 14 personas. Las asignaciones
anteriores se conservan y siguen incluidas en los respaldos.

Lee [la guía de configuración y uso](SETUP-COMPARTIDO.md). Para actualizar una
instalación privada existente, ejecuta [supabase/public-read.sql](supabase/public-read.sql)
en el SQL Editor de Supabase. Publicar los archivos HTML no cambia esos permisos.

Para desarrollo:

```sh
npm ci --cache /tmp/projectflow-npm --ignore-scripts
python3 -m http.server 8000 --bind 127.0.0.1
```

El sitio es estático y no necesita compilación. La biblioteca de Supabase está
incluida en `assets/vendor`; `npm run vendor` la reproduce desde la versión exacta
del lockfile cuando se actualice la dependencia.

Comprobaciones:

```sh
npm test
npm run test:browser
```

Las pruebas de permisos ejecutan el SQL en PostgreSQL mediante PGlite, incluyendo
la actualización desde la instalación privada. Las pruebas de navegador necesitan
Python con Playwright y Chromium en `/usr/bin/chromium`; simulan Supabase y no
modifican el proyecto real. Cubren lectura pública, edición autorizada, agenda,
fechas, actualización automática, conflictos, respaldos y acceso móvil.
