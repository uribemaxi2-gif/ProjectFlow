(async () => {
  'use strict';
  await ProjectFlow.ready();
  const info = ProjectFlow.project();
  const lowerRoles = ['viewer', 'qa', 'pm_junior'];
  const allowedRoles = Object.entries(ProjectFlowRoles.labels).filter(([role]) => info.role === 'admin' || lowerRoles.includes(role));
  const canManagePerson = person => info.canManage && (info.scopeVersion < 2 || info.role === 'admin' || lowerRoles.includes(person.role));
  const bar = document.createElement('section');
  bar.id = 'pf-projects'; bar.setAttribute('aria-label', 'Proyecto seleccionado');
  bar.innerHTML = `<div><label for="pf-project-select">Proyecto</label> <select id="pf-project-select" hidden></select><strong id="pf-project-name"></strong></div>
    <div class="pf-project-actions"><button id="pf-share-project" type="button">Copiar enlace de lectura</button><button id="pf-new-project" type="button" hidden>+ Nuevo proyecto</button><button id="pf-project-access" type="button" hidden>Quién puede editar</button></div><p id="pf-project-message" role="status"></p>`;
  document.getElementById('pf-project-content').append(bar);
  const find = id => document.getElementById(id);
  const message = text => { find('pf-project-message').textContent = text; };
  updateName();
  find('pf-new-project').hidden = !info.canCreate;
  find('pf-project-access').hidden = !info.canInvite;
  if (info.rolesVersion) find('pf-project-access').textContent = info.canManage ? 'Roles e invitaciones' : 'Invitar personas';
  if (!info.multi && ProjectFlow.canEdit()) message('La creación de proyectos estará disponible cuando completes la actualización de Supabase.');
  else if (info.scopeVersion < 2 && info.canInvite) message('Para activar Admin global y los nuevos permisos de PM, ejecuta setup.sql en Supabase.');
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
    find('pf-current-project').textContent = name;
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
    ${info.rolesVersion && info.role !== 'admin' ? '<p>Conservarás tu rol. Los admins globales también podrán administrar el nuevo proyecto.</p>' : ''}
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
      const project = await ProjectFlow.projectRpc(info.rolesVersion ? 'projectflow_create_project_from' : 'projectflow_create_project',
        { p_name: values.get('name').trim(), p_start: start || null, p_due: due || null, p_weeks: Number(values.get('weeks')),
          ...(info.rolesVersion ? { p_source_project_id: info.id } : {}) });
      dialog.close(); message('Proyecto creado. Ya está disponible en tu lista.');
      find('pf-project-select').add(new Option(project.name, project.project_id));
      find('pf-project-select').hidden = false; find('pf-project-name').hidden = true;
      ProjectFlow.navigate(ProjectFlow.projectUrl(project.project_id));
    } catch (error) { find('pf-create-error').textContent = error.message; }
    finally { creating = false; form.querySelectorAll('button').forEach(button => button.disabled = false); }
  });
  const access = document.createElement('dialog'); access.id = 'pf-access-dialog';
  access.innerHTML = `<div class="pf-access-header"><h2 id="pf-access-heading" tabindex="-1">${info.rolesVersion ? info.canManage ? 'Roles e invitaciones' : 'Invitar personas' : 'Quién puede editar este proyecto'}</h2><button type="button" data-close-access aria-label="Cerrar permisos">×</button></div><p>El enlace permite leer sin cuenta. Los roles de proyecto se aplican aquí. Admin global da acceso a todos los proyectos de la web.</p>
    <section id="pf-members-section" ${info.canManage ? '' : 'hidden'}><h3>Personas con acceso</h3><ul id="pf-editor-list"></ul></section>
    <form id="pf-add-editor"><label>Correo de la persona<input name="email" type="email" required maxlength="254" placeholder="persona@ejemplo.com"></label>
    <label ${info.rolesVersion && info.canManage ? '' : 'hidden'}>Rol al aceptar<select name="role" id="pf-invite-role"></select></label>
    <p id="pf-invite-help" class="pf-role-help"></p>
    <p>Recibirá un enlace para aceptar. Si es su primera vez, creará su propia contraseña; tú no necesitas conocerla.</p><button type="submit">Enviar invitación</button></form>
    <h3>Invitaciones pendientes</h3><ul id="pf-invitation-list"></ul>
    <p id="pf-access-message" role="status"></p><button type="button" id="pf-access-close">Cerrar</button>`;
  document.body.append(access);
  for (const [value, label] of allowedRoles) find('pf-invite-role').add(new Option(label, value));
  find('pf-invite-role').value = 'qa';
  const invitationHelp = () => {
    find('pf-invite-help').textContent = !info.rolesVersion ? '' : info.canManage
      ? ProjectFlowRoles.descriptions[find('pf-invite-role').value]
      : 'Las personas que invites entrarán como Consultor / QA. Solo el admin podrá cambiar sus roles. Puedes reenviar o cancelar tus propias invitaciones pendientes.';
  };
  invitationHelp(); find('pf-invite-role').addEventListener('change', invitationHelp);
  let changingAccess = false, invitationsReady = false;
  function accessBusy(busy) {
    changingAccess = busy;
    access.querySelectorAll('button, select').forEach(button => button.disabled = busy);
    find('pf-add-editor').querySelectorAll('input, button, select').forEach(field => field.disabled = busy || !invitationsReady);
    find('pf-invite-role').disabled = busy || !invitationsReady || !info.canManage;
  }
  function renderEditors(editors) {
    find('pf-editor-list').replaceChildren(...editors.filter(person => person.active).map(person => {
      const li = document.createElement('li'), label = document.createElement('span');
      label.textContent = ((person.name || 'Sin alias') + ' · ' + person.email) + (info.rolesVersion ? ' · ' + ProjectFlowRoles.labels[person.role] : person.owner ? ' · Propietario' : ' · Puede editar'); li.append(label);
      if (info.rolesVersion && canManagePerson(person)) {
        const controls = document.createElement('div'), roleLabel = document.createElement('label'), select = document.createElement('select');
        controls.className = 'pf-member-controls'; roleLabel.textContent = 'Rol'; select.setAttribute('aria-label', 'Rol de ' + person.email);
        for (const [value, name] of allowedRoles) select.add(new Option(name, value));
        select.value = person.role; roleLabel.append(select);
        const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Guardar rol';
        save.addEventListener('click', () => { if (select.value !== person.role) changeRole(person.email, select.value); });
        controls.append(roleLabel, save); li.append(controls);
      }
      if (canManagePerson(person) && (!person.owner || info.rolesVersion)) {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = person.role === 'admin' && info.scopeVersion >= 2 ? 'Retirar Admin global' : 'Quitar permiso';
        remove.addEventListener('click', () => changeAccess(person.email)); li.append(remove);
      }
      return li;
    }));
  }
  function renderInvitations(invitations) {
    const nodes = invitations.map(invitation => {
      const li = document.createElement('li'), label = document.createElement('span'), actions = document.createElement('div');
      label.textContent = `${invitation.email}${info.rolesVersion ? ' · ' + ProjectFlowRoles.labels[invitation.role] : ''} · ${invitation.expired ? 'Vencida' : 'Pendiente de aceptación'}`;
      const resend = document.createElement('button'); resend.type = 'button'; resend.textContent = 'Reenviar';
      resend.addEventListener('click', () => sendInvitation(invitation.email, invitation.role || 'qa'));
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancelar invitación';
      cancel.addEventListener('click', () => cancelInvitation(invitation.id));
      actions.className = 'pf-project-actions'; actions.append(resend, cancel); li.append(label, actions); return li;
    });
    if (!nodes.length) { const empty = document.createElement('li'); empty.textContent = 'No hay invitaciones pendientes.'; nodes.push(empty); }
    find('pf-invitation-list').replaceChildren(...nodes);
  }
  async function refreshAccess() {
    if (info.canManage) renderEditors(await ProjectFlow.projectRpc('projectflow_list_editors', { p_project_id: info.id }));
    try {
      renderInvitations(await ProjectFlow.projectRpc('projectflow_list_invitations', { p_project_id: info.id }));
      invitationsReady = true;
    } catch (error) {
      invitationsReady = false;
      find('pf-invitation-list').replaceChildren();
      if (error.code === 'PGRST202') throw new Error('Las invitaciones aún no están activadas. Completa la actualización de Supabase indicada en la guía de invitaciones.');
      throw error;
    }
  }
  async function changeAccess(email) {
    if (changingAccess) return;
    accessBusy(true);
    try {
      renderEditors(await ProjectFlow.projectRpc('projectflow_set_editor', { p_project_id: info.id, p_email: email, p_enabled: false }));
      if (info.rolesVersion && !await ProjectFlow.checkPermissions()) return;
      if (invitationsReady) await refreshAccess();
      find('pf-access-message').textContent = 'Permiso retirado. Si era Admin global, perdió ese acceso a toda la web. La lectura pública sigue disponible.';
    } catch (error) { find('pf-access-message').textContent = error.message; }
    finally { accessBusy(false); }
  }
  async function changeRole(email, role) {
    if (changingAccess || !info.canManage) return;
    accessBusy(true);
    try {
      await ProjectFlow.projectRpc('projectflow_set_member_role', { p_project_id: info.id, p_email: email, p_role: role });
      if (!await ProjectFlow.checkPermissions()) return;
      await refreshAccess(); find('pf-access-message').textContent = 'Rol actualizado: ' + ProjectFlowRoles.labels[role] + (info.scopeVersion >= 2 ? '. Admin tiene alcance global; los demás roles corresponden al proyecto.' : '. Solo afecta a este proyecto.');
    } catch (error) { find('pf-access-message').textContent = error.message; }
    finally { accessBusy(false); }
  }
  async function sendInvitation(email, role = 'qa') {
    if (changingAccess || !invitationsReady) return;
    accessBusy(true); find('pf-access-message').textContent = 'Preparando la invitación…';
    try {
      const result = await ProjectFlow.inviteEditor(email, role);
      await refreshAccess();
      find('pf-access-message').textContent = result.sent
        ? info.rolesVersion ? 'Invitación enviada. Al aceptar tendrá el rol ' + ProjectFlowRoles.labels[role] + (role === 'admin' && info.scopeVersion >= 2 ? ' en toda la web.' : ' solo en este proyecto.') : 'Invitación enviada. La persona debe aceptarla para editar solo este proyecto.'
        : result.errorCode === 'over_email_send_rate_limit'
          ? 'La invitación quedó pendiente, pero no se envió el correo: alcanzaste el límite de envíos. Espera antes de reenviar.'
          : 'La invitación quedó pendiente, pero no se pudo enviar el correo. Revisa la configuración de correo en Supabase y luego pulsa Reenviar.';
      if (result.sent) { find('pf-add-editor').reset(); find('pf-invite-role').value = 'qa'; invitationHelp(); }
    } catch (error) { find('pf-access-message').textContent = error.message; }
    finally { accessBusy(false); }
  }
  async function cancelInvitation(id) {
    if (changingAccess) return;
    accessBusy(true);
    try {
      await ProjectFlow.projectRpc('projectflow_cancel_invitation', { p_project_id: info.id, p_invitation_id: id });
      await refreshAccess(); find('pf-access-message').textContent = 'Invitación cancelada. Ese enlace ya no concede permiso de edición.';
    } catch (error) { find('pf-access-message').textContent = error.message; }
    finally { accessBusy(false); }
  }
  access.addEventListener('cancel', event => { if (changingAccess) event.preventDefault(); });
  find('pf-project-access').addEventListener('click', async () => {
    access.showModal(); accessBusy(true); find('pf-access-message').textContent = 'Cargando permisos…';
    try { await refreshAccess(); find('pf-access-message').textContent = ''; }
    catch (error) { find('pf-access-message').textContent = error.message; }
    finally {
      accessBusy(false);
      if (info.rolesVersion && info.canManage) { access.scrollTop = 0; find('pf-access-heading').focus({ preventScroll: true }); }
      else find('pf-add-editor').querySelector('input').focus();
    }
  });
  find('pf-add-editor').addEventListener('submit', event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    sendInvitation(values.get('email'), info.canManage && info.rolesVersion ? values.get('role') : 'qa');
  });
  find('pf-access-close').addEventListener('click', () => access.close());
  access.querySelector('[data-close-access]').addEventListener('click', () => access.close());
})();
