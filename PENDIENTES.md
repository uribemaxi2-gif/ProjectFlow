# Mejoras de solicitudes — 8 de noviembre de 2026

Implementado al retomar «continúa»:

- Rango del creador visible automáticamente en alta, consulta y edición.
- Verificado el guardado de Admin global y su conservación al editar desde otra cuenta.
- Los registros antiguos sin rango mantienen «Cargo no registrado»; no se inventa
  el autor a partir del nombre del solicitante ni del usuario que los consulta.
- Rango y estado a la derecha; etiquetas y filtros separados; acciones al pie.
- Responsable asignado separado del solicitante, con opción «Sin asignar».
- Selector limitado a participantes activos QA o superiores del proyecto y admins
  globales. Solo los editores asignan; QA no puede hacerlo desde su formulario ni RPC.
- Nombres de responsables conservados en registros históricos; validación de nuevas
  asignaciones en Supabase. El formulario conserva lo escrito si falla la carga.

Activación remota pendiente: ejecutar el setup.sql actualizado en Supabase y
recargar la web. No se dispone de acceso administrativo a esa base desde este entorno.
No se pudo comprobar la versión o los metadatos originales de la solicitud «visual»
de la captura; las pruebas nuevas no reprodujeron pérdida del rango de Admin.
