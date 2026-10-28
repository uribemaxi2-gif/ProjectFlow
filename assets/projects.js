(async () => {
  'use strict';
  await ProjectFlow.ready();
  const info = ProjectFlow.project();
  const bar = document.createElement('section');
  bar.id = 'pf-projects'; bar.setAttribute('aria-label', 'Proyecto seleccionado');
  bar.innerHTML = `<div><label for="pf-project-select">Proyecto</label> <select id="pf-project-select" hidden></select><strong id="pf-project-name"></strong></div>
    <div class="pf-project-actions"><button id="pf-share-project" type="button">Copiar enlace de lectura</button><button id="pf-new-project" type="button" hidden>+ Nuevo proyecto</button><button id="pf-project-access" type="button" hidden>Quién puede editar</button></div><p id="pf-project-message" role="status"></p>`;
  document.getElementById('pf-session').after(bar);
  const find = id => document.getElementById(id);
  const message = text => { find('pf-project-message').textContent = text; };
  find('pf-project-name').textContent = info.name;
  find('pf-new-project').hidden = !info.canCreate;
  find('pf-project-access').hidden = !info.canManage;
  if (!info.multi && ProjectFlow.canEdit()) message('La creación de proyectos estará disponible cuando completes la actualización de Supabase.');
  if (info.signedIn && info.multi) {
    try {
      const projects = await ProjectFlow.projectRpc('projectflow_list_projects');
      if (!projects.some(p => p.id === info.id)) projects.unshift({ id: info.id, name: info.name });
      for (const project of projects) find('pf-project-select').add(new Option(project.name, project.id));
      find('pf-project-select').value = info.id;
      find('pf-project-select').hidden = false; find('pf-project-name').hidden = true;
    } catch { message('No se pudo cargar tu lista de proyectos. Recarga para volver a intentarlo.'); }
  }
  find('pf-project-select').addEventListener('change', () => {
    const next = find('pf-project-select').value;
    if (!ProjectFlow.navigate(ProjectFlow.projectUrl(next))) find('pf-project-select').value = info.id;
  });
  function updateName() {
    const name = ProjectFlow.project().name;
    find('pf-project-name').textContent = name;
    const option = Array.from(find('pf-project-select').options).find(item => item.value === info.id);
    if (option) option.textContent = name;
  }
  document.addEventListener('projectflow:saved', updateName);
  document.addEventListener('projectflow:updated', updateName);
  find('pf-share-project').addEventListener('click', async () => {
    const url = ProjectFlow.projectUrl();
    try { await navigator.clipboard.writeText(url); message('Enlace copiado. Permite consultar este proyecto, sin editar.'); }
    catch { message(`Copia este enlace de lectura: ${url}`); }
  });
  const dialog = document.createElement('dialog'); dialog.id = 'pf-project-dialog';
  dialog.innerHTML = `<form id="pf-project-create"><h2>Nuevo proyecto</h2>
    <label>Nombre<input name="name" required maxlength="120" placeholder="Ej.: Mi aplicación"></label>
    <div class="pf-project-grid"><label>Inicio<input name="start" type="date"></label><label>Entrega del proyecto<input name="due" type="date"></label></div>
    <label>Semanas iniciales<input name="weeks" type="number" min="1" max="104" value="4" required></label>
    <p>Podrás añadir o quitar semanas y tareas, y ajustar sus fechas por separado.</p>
    <p id="pf-create-error" role="status"></p><div class="pf-project-actions"><button type="button" data-close-project>Cancelar</button><button type="submit">Crear proyecto</button></div></form>`;
  document.body.append(dialog);
  find('pf-new-project').addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-close-project]').addEventListener('click', () => dialog.close());
  let creating = false;
  dialog.addEventListener('cancel', e => { if (creating) e.preventDefault(); });
  find('pf-project-create').addEventListener('submit', async event => {
    event.preventDefault(); if (creating) return;
    const form = event.currentTarget, values = new FormData(form);
    const start = values.get('start'), due = values.get('due');
    if (start && due && due < start) { find('pf-create-error').textContent = 'La entrega no puede ser anterior al inicio.'; return; }
    creating = true; form.querySelectorAll('button').forEach(button => button.disabled = true);
    find('pf-create-error').textContent = 'Creando proyecto…';
    try {
      const project = await ProjectFlow.projectRpc('projectflow_create_project', { p_name: values.get('name').trim(), p_start: start || null, p_due: due || null, p_weeks: Number(values.get('weeks')) });
      dialog.close(); message('Proyecto creado. Ya está disponible en tu lista.');
      find('pf-project-select').add(new Option(project.name, project.project_id));
      find('pf-project-select').hidden = false; find('pf-project-name').hidden = true;
      ProjectFlow.navigate(ProjectFlow.projectUrl(project.project_id));
    } catch (error) { find('pf-create-error').textContent = error.message; }
    finally { creating = false; form.querySelectorAll('button').forEach(button => button.disabled = false); }
  });
  const access = document.createElement('dialog'); access.id = 'pf-access-dialog';
  access.innerHTML = `<h2>Quién puede editar este proyecto</h2><p>El enlace solo permite leer. La edición se concede por separado para cada proyecto.</p>
    <ul id="pf-editor-list"></ul><form id="pf-add-editor"><label>Correo de la cuenta<input name="email" type="email" required placeholder="persona@ejemplo.com"></label><p>Crea primero la cuenta en Supabase → Authentication → Users. Después autorízala aquí.</p><button type="submit">Autorizar edición</button></form><p id="pf-access-message" role="status"></p><button type="button" id="pf-access-close">Cerrar</button>`;
  document.body.append(access);
  let changingAccess = false;
  function renderEditors(editors) {
    find('pf-editor-list').replaceChildren(...editors.filter(person => person.active).map(person => {
      const li = document.createElement('li'), label = document.createElement('span');
      label.textContent = person.email + (person.owner ? ' · Propietario' : ' · Puede editar'); li.append(label);
      if (!person.owner) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Quitar permiso';
        remove.addEventListener('click', () => changeAccess(person.email, false)); li.append(remove);
      }
      return li;
    }));
  }
  async function changeAccess(email, enabled) {
    if (changingAccess) return;
    changingAccess = true; access.querySelectorAll('button').forEach(button => button.disabled = true);
    try {
      renderEditors(await ProjectFlow.projectRpc('projectflow_set_editor', { p_project_id: info.id, p_email: email, p_enabled: enabled }));
      find('pf-access-message').textContent = enabled ? 'Edición autorizada solo en este proyecto.' : 'Permiso de edición retirado de este proyecto.';
      find('pf-add-editor').reset();
    } catch (error) { find('pf-access-message').textContent = error.message; }
    finally { changingAccess = false; access.querySelectorAll('button').forEach(button => button.disabled = false); }
  }
  find('pf-project-access').addEventListener('click', async () => {
    access.showModal(); find('pf-access-message').textContent = 'Cargando permisos…';
    try { renderEditors(await ProjectFlow.projectRpc('projectflow_list_editors', { p_project_id: info.id })); find('pf-access-message').textContent = ''; }
    catch (error) { find('pf-access-message').textContent = error.message; }
  });
  find('pf-add-editor').addEventListener('submit', event => { event.preventDefault(); changeAccess(new FormData(event.currentTarget).get('email'), true); });
  find('pf-access-close').addEventListener('click', () => access.close());
})();
