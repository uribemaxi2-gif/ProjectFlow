(() => {
  'use strict';
  // Etiquetas de interfaz. La autorización real se comprueba en Supabase.
  const labels = Object.freeze({ viewer: 'Usuario · Solo lectura', qa: 'Consultor / QA', pm_junior: 'PM menor', pm: 'PM', admin: 'Admin global' });
  const descriptions = Object.freeze({
    viewer: 'Puedes consultar el proyecto. La lectura también está disponible sin cuenta.',
    qa: 'Puedes leer y enviar solicitudes, ideas y reportes de errores desde Mi proyecto.',
    pm_junior: 'Puedes gestionar los datos y crear proyectos. No puedes invitar ni administrar roles.',
    pm: 'Puedes administrar tus proyectos e invitar y asignar Usuario, Consultor / QA y PM menor. No puedes modificar otros PM ni admins.',
    admin: 'Puedes administrar toda la web y todos los proyectos, invitar a cualquiera de ellos y nombrar o retirar otros admins globales.'
  });
  window.ProjectFlowRoles = Object.freeze({ labels, descriptions });
})();
