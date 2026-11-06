(() => {
  'use strict';
  // Etiquetas de interfaz. La autorización real se comprueba en Supabase.
  const labels = Object.freeze({ viewer: 'Usuario · Solo lectura', qa: 'Consultor / QA', pm_junior: 'PM menor', pm: 'PM', admin: 'Admin' });
  const descriptions = Object.freeze({
    viewer: 'Puedes consultar el proyecto. La lectura también está disponible sin cuenta.',
    qa: 'Puedes leer y enviar solicitudes, ideas y reportes de errores desde Mi proyecto.',
    pm_junior: 'Puedes gestionar los datos y crear proyectos. No puedes invitar ni administrar roles.',
    pm: 'Puedes gestionar los datos, crear proyectos e invitar como Consultor / QA. El admin administra los roles.',
    admin: 'Puedes gestionar los datos, crear proyectos, enviar invitaciones y administrar los roles de este proyecto.'
  });
  window.ProjectFlowRoles = Object.freeze({ labels, descriptions });
})();
