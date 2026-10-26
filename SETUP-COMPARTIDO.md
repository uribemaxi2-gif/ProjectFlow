# Mi espacio personal: consulta con enlace y edición autorizada

## Actualizar la instalación anterior

Si ya ejecutaste el SQL de la versión privada y creaste tu cuenta:

1. Abre [supabase/public-read.sql](supabase/public-read.sql) y copia todo su contenido.
2. En tu proyecto de Supabase, abre **SQL Editor → New query**, pega el contenido
   y pulsa **Run**.
3. Cuando aparezca **Success**, recarga ProjectFlow. Una ventana privada debe
   permitir consultar la agenda, el plan semanal y el proyecto sin iniciar sesión.

La actualización conserva los datos, las cuentas y sus autorizaciones. Se puede
repetir. No es necesario volver a crear tu usuario ni cambiar la clave pública.
La web mantiene disponible el inicio de sesión mientras este paso esté pendiente.

## Consultar y trabajar

Comparte la dirección habitual de GitHub Pages. Quien la abra podrá ver los datos,
buscar, filtrar, abrir el detalle de los registros y descargar una copia. Los
visitantes no necesitan crear una cuenta. La vista indica **Solo lectura**.
Todo el contenido guardado en este espacio es consultable con el enlace.

Para editar, pulsa **Entrar para editar** y usa la cuenta creada en
**Authentication → Users**. No es la cuenta con la que administras Supabase.
Solo las cuentas activas que el propietario autorice pueden modificar información.
Los permisos se aplican en la base de datos, además de en los formularios.

- **Mi agenda:** actividades personales con nombre, fecha prevista y casilla de
  completada. Puedes añadir o eliminar actividades. No asigna tareas a otras
  personas ni concede permisos de edición. Los ejemplos iniciales son editables.
- **Plan semanal:** conserva las cuatro semanas y una de reserva, organizadas por
  tus áreas de trabajo. Marca los hitos a medida que los completes.
- **Mi proyecto:** ficha, solicitudes y tareas, revisiones, acuerdos y notas.
  Usa **Ver detalle** para consultar los campos completos en modo de lectura.

La agenda y los hitos se guardan al modificarlos. La ficha y los registros usan
sus botones de guardado. Espera **Guardado compartido** antes de cerrar.
Si falla la conexión, los cambios pendientes permanecen en pantalla y se indica
que aún no están compartidos.

La vista de lectura carga los cambios automáticamente cada 30 segundos mientras
está visible. Quien esté editando recibe un aviso y puede pulsar **Actualizar**.
Si dos editores cambian la misma sección, se rechaza el guardado obsoleto para
no sobrescribir cambios. Conserva lo escrito, actualiza y vuelve a aplicarlo.

## Autorizar a otra persona para editar

1. En **Authentication → Users → Add user → Create new user**, crea su cuenta
   con correo y contraseña. Activa **Auto Confirm User** si aparece.
2. Desde **SQL Editor**, ejecuta esta consulta con su correo real:

   ```sql
   select public.projectflow_authorize('colaborador@ejemplo.com', 'responsible');
   ```

3. Esa persona usa el mismo enlace y pulsa **Entrar para editar**.

Tu propia cuenta puede seguir con el rol `leader`. Ambos roles permiten editar;
ninguno permite autorizar cuentas desde el navegador. Las cuentas nuevas que no
autorices tienen únicamente el mismo acceso de lectura que cualquier visitante.

Para retirar el permiso de edición conservando los registros:

```sql
update public.projectflow_members set active = false
where user_id = (
  select id from auth.users where email = 'persona@ejemplo.com'
);
```

La siguiente escritura se rechazará. En la comprobación de permisos o al intentar
guardar, una página abierta pedirá volver a cargar el acceso. La lectura seguirá
disponible con el enlace.

## Datos anteriores y respaldos

Las asignaciones del equipo anterior se mantienen en **Mi agenda → Datos
conservados del proyecto anterior**. Las actividades nuevas se guardan junto a
esos datos. No se convierten nombres anteriores en fechas ni se borran registros.

Si los datos antiguos solo estaban en un navegador:

1. Abre la misma dirección con ese navegador e inicia sesión para editar.
2. Usa **Descargar datos anteriores** si aparece en la barra superior.
3. Desde **Mi proyecto → Ficha del proyecto**, usa **Importar respaldo**.
4. Revisa la confirmación: se reemplazan los registros compartidos y las secciones
   incluidas en el archivo. Descarga antes un respaldo actual si necesitas conservarlo.

Los respaldos nuevos incluyen la agenda con fechas y los hitos. Los respaldos
antiguos siguen siendo compatibles. No se importa nada automáticamente.

## Instalación nueva

1. Crea el proyecto de Supabase y ejecuta todo [supabase/setup.sql](supabase/setup.sql)
   desde **SQL Editor**. Incluye la lectura pública; no hace falta aplicar el otro SQL.
2. Crea tu cuenta en **Authentication → Users**, como en los pasos anteriores.
3. Autorízala desde **SQL Editor**:

   ```sql
   select public.projectflow_authorize('mi-correo@ejemplo.com', 'leader');
   ```

4. Completa `config.js` con la URL y la clave **Publishable** del proyecto.
   Nunca uses contraseñas, claves `secret` o `service_role` en el frontend.
5. Publica el repositorio con el workflow de GitHub Pages.

## Verificar el acceso real

1. Espera a que **Deploy static content to Pages** termine en Actions.
2. Abre una ventana privada: debes poder consultar las tres páginas sin cuenta.
3. Entra como editor en otro navegador, guarda una actividad y una fecha.
4. En la ventana privada, pulsa **Actualizar** o espera 30 segundos y comprueba
   que aparecen. Los campos deben seguir en modo de lectura.
5. Pulsa **Salir** en la cuenta editora: debes volver a la consulta sin poder editar.

Las pruebas locales usan una API simulada para el navegador y PostgreSQL local
para los permisos. No sustituyen esta comprobación contra tu proyecto de Supabase.
