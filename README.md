# ProjectFlow

Organización del equipo, cronograma y registros del proyecto. Las tres páginas
comparten datos mediante Supabase y requieren una cuenta autorizada como líder
o responsable. Tener el enlace no da acceso a los registros.

- `index.html`: integrantes y roles.
- `cronograma.html`: semanas e hitos compartidos.
- `proyecto.html`: ficha, solicitudes, revisiones, acuerdos y respaldos.

Lee [la guía de configuración y uso](SETUP-COMPARTIDO.md) para autorizar cuentas,
recuperar datos de la versión anterior y publicar en GitHub Pages.

Para desarrollo:

```sh
npm ci --ignore-scripts
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

Las pruebas de permisos ejecutan el SQL en PostgreSQL mediante PGlite. Las pruebas
del navegador necesitan Python con Playwright y Chromium en `/usr/bin/chromium`;
simulan la API de Supabase y no envían correo ni modifican el proyecto real.
