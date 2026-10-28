# Varios proyectos con fechas y permisos independientes

## Activar esta versión

1. Copia **todo** [supabase/setup.sql](supabase/setup.sql).
2. En tu proyecto de Supabase, abre **SQL Editor → New query**, pega el contenido
   y pulsa **Run**.
3. Cuando termine correctamente, recarga ProjectFlow.

Este SQL sustituye al paso anterior de `public-read.sql`: no necesitas ejecutarlos
por separado. Sirve tanto si ya activaste la lectura pública como si aún tienes
la primera versión privada. Se puede repetir sin borrar datos ni reactivar permisos
retirados. El proyecto anterior sigue disponible en el enlace habitual.

La web conserva el acceso al proyecto anterior mientras falte el SQL. Crear y
cambiar de proyecto requiere completar esta actualización en Supabase.

Si es una instalación completamente nueva, crea tu cuenta en
**Authentication → Users → Add user → Create new user**, con correo y contraseña.
Activa **Auto Confirm User** si aparece. Después autorízala desde SQL Editor:

```sql
select public.projectflow_authorize('mi-correo@ejemplo.com', 'leader');
```

`config.js` usa únicamente la URL y la clave **Publishable**. Nunca introduzcas
contraseñas ni claves `secret` o `service_role` en el frontend.

## Crear y cambiar de proyecto

Entra con tu cuenta de propietario y pulsa **+ Nuevo proyecto**. Indica:

- Nombre.
- Fecha de inicio y fecha de entrega, si ya las conoces.
- Número inicial de semanas (de 1 a 104).

Cada proyecto empieza con su propia agenda vacía, ficha y plan. El número de semanas
no obliga a tener un número fijo de tareas. El selector **Proyecto** cambia entre
los proyectos en los que puedes editar. La página conserva la selección al navegar
entre agenda, plan semanal y ficha.

Puedes cambiar nombre, inicio y entrega en **Mi proyecto → Ficha del proyecto**.
Esas fechas son referencias del proyecto: las fechas de semanas y tareas siguen
siendo independientes y no se reprograman automáticamente.

## Organizar semanas y tareas

**Mi agenda** permite agregar actividades, ponerles una fecha de entrega y asignarlas
a una semana o dejarlas sin semana. Cada actividad tiene su estado de completada.
Hay un máximo de 500 actividades por proyecto.

En **Plan semanal** puedes agregar o eliminar semanas, cambiar su nombre, objetivos,
inicio y final, marcar su avance o indicar que son de reserva. Las semanas de reserva
no cuentan para el porcentaje de progreso. Eliminar una semana conserva sus tareas y
fechas, dejándolas sin semana asignada.

El proyecto original conserva el plan de cuatro semanas más una de reserva como
punto de partida editable. Las asignaciones antiguas de personas siguen incluidas
en los respaldos y en **Mi agenda → Datos conservados del proyecto anterior**.

## Compartir y autorizar editores

**Copiar enlace de lectura** crea un enlace al proyecto seleccionado. Quien lo
reciba podrá consultar sus datos sin cuenta, buscar, filtrar y descargar una copia.
No verá tu selector con otros proyectos. Todo el contenido de ese proyecto es
consultable con su enlace.

Para permitir que alguien edite:

1. Crea su cuenta una sola vez en **Supabase → Authentication → Users** con
   correo y contraseña. La cuenta de la aplicación es distinta a la del panel de Supabase.
2. Abre el proyecto que quieres compartir como propietario.
3. Pulsa **Quién puede editar**, escribe el correo de esa cuenta y pulsa
   **Autorizar edición**.
4. Esa persona entra con **Entrar para editar** en el enlace del proyecto.

Autorizar a alguien en un proyecto **no** le concede edición en los demás.
Los editores no pueden crear proyectos, conceder permisos ni ver la lista de editores.
Para retirar el permiso, abre **Quién puede editar → Quitar permiso** en ese proyecto.
La siguiente escritura se rechazará. La lectura seguirá disponible con el enlace.

Los permisos del proyecto original se migran: las cuentas `leader` son propietarios
y pueden crear proyectos; las cuentas `responsible` solo pueden editar ese proyecto.
La administración de acceso posterior se hace por proyecto desde la web.

## Guardado, cambios y respaldos

La agenda y el plan se guardan al modificarlos. La ficha y los registros usan sus
botones. Espera **Guardado compartido** antes de salir o cambiar de proyecto.
Si falla el guardado, se conserva el borrador y se muestra el error.

La consulta se actualiza cada 30 segundos mientras está visible. Los editores reciben
un aviso y pueden pulsar **Actualizar**. Si alguien guardó cambios sobre la misma
sección, se rechaza el guardado obsoleto para evitar sobrescrituras.

Los respaldos JSON corresponden **solo al proyecto seleccionado**: incluyen ficha,
registros, agenda, fechas y semanas. Importar reemplaza esas secciones en ese mismo
proyecto; no modifica otros proyectos ni sus permisos. Los respaldos antiguos siguen
siendo compatibles. Descarga una copia antes de reemplazar información.

Para rescatar datos que solo estaban en un navegador, entra allí como editor y usa
**Descargar datos anteriores**, si aparece. Luego importa el archivo en el proyecto
que corresponda. Nada se importa automáticamente.

## Comprobar el servicio real

1. Espera a que el despliegue de Pages termine correctamente.
2. Ejecuta el SQL y entra como propietario.
3. Crea dos proyectos con distinta duración y guarda una tarea en el primero.
4. Cambia al segundo: no debe aparecer la tarea del primero.
5. Autoriza un colaborador solo en el primero y comprueba que en el segundo
   tenga únicamente lectura.
6. Abre el enlace de un proyecto en una ventana privada: debe permitir leer,
   sin mostrar el catálogo ni los botones de edición.

Las pruebas locales verifican PostgreSQL y el navegador con una API simulada;
no sustituyen esta comprobación contra tu Supabase real.
