(() => {
  'use strict';
  const KEYS = ['equipo14.personas', 'equipo14.hitos', 'projecthub.cliente.v1'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  let client, cache = {}, unlocked = false, editor = false, conflict = false, queue = Promise.resolve(), pending = 0;
  let projectId = new URLSearchParams(location.search).get('project'), projectInfo = {}, multi = true;
  const dirty = new Map();
  let generation = 0, completeReady;
  const ready = new Promise(resolve => { completeReady = resolve; });
  const gate = document.createElement('section');
  gate.id = 'pf-gate';
  gate.innerHTML = `<div class="pf-card"><h1>ProjectFlow</h1>
    <p>Consulta el espacio con el enlace. Para enviar solicitudes o gestionar el proyecto, entra con una cuenta autorizada.</p>
    <form id="pf-login" hidden>
      <label for="pf-email-input">Correo</label><input id="pf-email-input" type="email" autocomplete="username" required>
      <label for="pf-password">Contraseña</label><input id="pf-password" type="password" autocomplete="current-password" required>
      <button type="submit" id="pf-enter">Entrar</button>
      <button type="button" id="pf-login-link">Recibir enlace por correo</button>
      <p>Si aún no tienes contraseña o no la recuerdas, recibe un enlace para entrar y definirla en Ajustes.</p>
    </form>
    <p id="pf-message" role="status" aria-live="polite">Cargando datos compartidos…</p>
    <button id="pf-retry" type="button" hidden>Reintentar</button>
    <button id="pf-cancel-login" type="button" hidden>Volver a consultar</button>
    <p>El admin asigna el rol de cada cuenta en este proyecto.</p>
  </div>`;
  document.body.prepend(gate);
  const find = id => document.getElementById(id);
  const message = (text, error = false) => {
    find('pf-message').textContent = text;
    find('pf-message').dataset.error = String(error);
  };
  function status(text, error = false) {
    const target = find('pf-status');
    if (target) { target.textContent = text; target.dataset.error = String(error); }
  }
  function lock(text) {
    unlocked = false;
    editor = false;
    cache = {};
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.documentElement.classList.add('pf-locked');
    gate.hidden = false;
    find('pf-login').hidden = false;
    find('pf-retry').hidden = false;
    find('pf-cancel-login').hidden = true;
    message(text, true);
  }
  function canEdit() { return unlocked && editor; }
  function canSubmit() { return unlocked && (editor || projectInfo.role === 'qa'); }
  function stateRole(state) { return state.roles_version === 1 ? state.project_role : ({ leader: 'admin', responsible: 'pm_junior', viewer: 'viewer' })[state.role]; }
  function applyAccess(root = document) {
    document.documentElement.classList.toggle('pf-readonly', !canEdit());
    document.documentElement.classList.toggle('pf-nosubmit', !canSubmit());
    root.querySelectorAll('[data-pf-field], [data-pf-form] input, [data-pf-form] textarea, [data-pf-form] select').forEach(field => {
      const allowed = canEdit() || (canSubmit() && !!field.closest('[data-pf-submit-form="true"]'));
      if (field.matches('select, [type=checkbox], [type=file], [type=radio]')) field.disabled = !allowed || field.dataset.pfUnavailable === 'true';
      else field.readOnly = !allowed;
      field.setAttribute('aria-readonly', String(!allowed));
    });
  }
  function markDirty(key) { if (canEdit() || (canSubmit() && key === 'draft:entry')) { dirty.set(key, ++generation); status('Cambios sin guardar'); } }
  function clean(key) { dirty.delete(key); }
  function normalizeSchedule(items) {
    if (!Array.isArray(items) || items.length > 500) throw new Error('Agenda no válida.');
    const ids = new Set();
    return items.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string') throw new Error('Actividad no válida.');
      ids.add(item.id);
      return { id: item.id, title: item.title.slice(0, 160), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate || '') ? item.dueDate : '', done: item.done === true, weekId: typeof item.weekId === 'string' && /^[\w-]{1,80}$/.test(item.weekId) ? item.weekId : '' };
    });
  }
  function errorText(error) {
    if (error?.code === '22023' && typeof error.message === 'string') return error.message;
    if (error?.code === '40001') return 'Otra persona guardó cambios. Conserva lo que escribiste y pulsa Actualizar antes de volver a guardar.';
    if (error?.code === '42501' || error?.status === 401 || error?.status === 403) return 'Tu cuenta no tiene permiso para editar. Pulsa Reintentar para volver a consultar.';
    return 'No se pudo conectar o guardar. Comprueba tu conexión y vuelve a intentarlo. Tus cambios todavía no están compartidos.';
  }
  async function requestState() {
    if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw new Error('El enlace del proyecto no es válido.');
    let result = await client.rpc(multi ? 'projectflow_get_project' : 'projectflow_get_state', multi ? { p_project_id: projectId } : {});
    if (result.error?.code === 'PGRST202' && !projectId) {
      multi = false;
      result = await client.rpc('projectflow_get_state');
    }
    const { data, error } = result;
    if (error) throw error;
    if (!data || !Object.hasOwn(ProjectFlowRoles.labels, stateRole(data)) || !data.data || typeof data.data !== 'object' || Array.isArray(data.data)) throw new Error('Estado no válido');
    return data;
  }
  function navigate(url) {
    if (pending) { status('Espera a que termine el guardado.'); return false; }
    if (dirty.size && !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de proyecto?')) return false;
    dirty.clear(); location.href = url; return true;
  }
  function projectUrl(id = projectId, page = 'index.html') {
    const url = new URL(page, location.href);
    if (id) url.searchParams.set('project', id);
    return url.href;
  }
  function preserveProjectLinks() {
    if (!projectId) return;
    document.querySelectorAll('a[href]').forEach(anchor => {
      const url = new URL(anchor.getAttribute('href'), location.href);
      if (url.origin === location.origin && /\/(index|cronograma|proyecto)\.html$/.test(url.pathname)) {
        url.searchParams.set('project', projectId); anchor.href = url.href;
      }
    });
  }
  async function projectRpc(name, params = {}) {
    if (!multi) throw new Error('Primero completa la actualización de proyectos múltiples en Supabase.');
    const { data, error } = await client.rpc(name, params);
    if (error) throw Object.assign(new Error(error.message || errorText(error)), { code: error.code });
    return data;
  }
  async function inviteEditor(email, role = 'qa') {
    const invitation = await projectRpc(projectInfo.rolesVersion ? 'projectflow_prepare_invitation_role' : 'projectflow_prepare_invitation',
      { p_project_id: projectId, p_email: email, ...(projectInfo.rolesVersion ? { p_role: role } : {}) });
    const destination = new URL('invitacion.html', location.href);
    destination.searchParams.set('invitation', invitation.id);
    // Supabase sends the verification email; no admin key or recipient password
    // is needed in the owner's browser. The database grants access on acceptance.
    const { error } = await client.auth.signInWithOtp({ email: invitation.email,
      options: { shouldCreateUser: true, emailRedirectTo: destination.href } });
    return { invitation, sent: !error, errorCode: error?.code || '' };
  }
  async function submitRequest(request) {
    if (!canSubmit()) throw new Error('Tu rol no permite enviar solicitudes.');
    pending++; status('Enviando solicitud…');
    try {
      const state = await projectRpc('projectflow_submit_request', { p_project_id: projectId, p_request: copy(request) });
      cache[KEYS[2]] = copy(state.data[KEYS[2]]);
      clean('draft:entry'); status('Guardado compartido');
    } catch (error) {
      if (error.code === '42501') lock('Tu permiso para enviar solicitudes cambió. Pulsa Reintentar.');
      status('No se pudo enviar la solicitud. Conserva lo escrito y vuelve a intentarlo.', true);
      throw error;
    } finally { pending--; }
  }
  async function checkPermissions() {
    const state = await requestState();
    if (projectInfo.role !== stateRole(state) || projectInfo.rolesVersion !== (state.roles_version || 0) || projectInfo.scopeVersion !== (state.scope_version || 1)) {
      lock('Tus permisos cambiaron. Pulsa Reintentar para cargar el acceso actual.');
      return false;
    }
    return true;
  }
  function get(key, fallback) {
    if (!unlocked) throw new Error('Espera a que se carguen los datos.');
    return copy(Object.hasOwn(cache, key) ? cache[key] : fallback);
  }
  function setMany(values) {
    if (!canEdit()) return Promise.reject(new Error('Solo las cuentas autorizadas pueden editar.'));
    const snapshot = copy(values), versions = new Map();
    for (const key of Object.keys(snapshot)) {
      if (!KEYS.includes(key)) return Promise.reject(new Error('Sección no válida.'));
      markDirty(key); versions.set(key, dirty.get(key));
    }
    pending++;
    const task = queue.catch(() => {}).then(async () => {
      try {
        if (conflict) throw { code: '40001' };
        if (!canEdit()) throw { code: '42501' };
        status('Guardando…');
        const updates = Object.entries(snapshot).map(([key, value]) => ({
          key, expected: Object.hasOwn(cache, key) ? copy(cache[key]) : null, value
        }));
        const { data: savedState, error } = await client.rpc(multi ? 'projectflow_save_project' : 'projectflow_save', multi ? { p_project_id: projectId, p_updates: updates } : { p_updates: updates });
        if (error) throw error;
        // Only advance baselines for the sections we actually wrote. Advancing
        // another section could hide changes that its visible form never saw.
        for (const [key, value] of Object.entries(snapshot)) {
          cache[key] = copy(savedState?.data && Object.hasOwn(savedState.data, key) ? savedState.data[key] : value);
          if (dirty.get(key) === versions.get(key)) clean(key);
        }
        updateAssigneeNames(savedState);
        document.dispatchEvent(new Event('projectflow:saved'));
        status('Guardado compartido');
      } catch (error) {
        if (error?.code === '40001') conflict = true;
        if (error?.code === '42501' || error?.status === 401 || error?.status === 403) lock(errorText(error));
        const text = errorText(error);
        status(text, true);
        throw new Error(text);
      } finally { pending--; }
    });
    queue = task;
    return task;
  }
  function downloadPreviousData() {
    try {
      const read = key => JSON.parse(localStorage.getItem(key) || '{}');
      const previous = read(KEYS[2]);
      const backup = {
        schema: 1, project: {}, requests: [], reviews: [], agreements: [], activity: [],
        ...previous, workspaces: { team: read(KEYS[0]), milestones: read(KEYS[1]) }
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'projectflow-datos-anteriores.json';
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('Respaldo descargado. Puedes importarlo desde Proyecto → Ficha del proyecto.');
    } catch { status('No se pudieron leer los datos anteriores de este navegador.', true); }
  }
  function showProfile(user) {
    const name = ProjectFlowProfile.name(user);
    projectInfo.displayName = name;
    if (find('pf-account-heading')) find('pf-account-heading').textContent = name || (user ? 'Elige tu nombre' : 'Tu cuenta');
    const avatar = document.querySelector('.pf-account-avatar');
    if (avatar) avatar.textContent = name ? name.split(' ').slice(0,2).map(word=>Array.from(word)[0]).join('').toLocaleUpperCase('es') : 'PF';
  }
  function profileForm(user) {
    const form = document.createElement('form'); form.id = 'pf-profile-form';
    form.innerHTML = `<label for="pf-display-name">Nombre o alias</label><input id="pf-display-name" autocomplete="nickname" maxlength="60" required placeholder="¿Cómo quieres que te llamemos?">
      <p>Se mostrará en tus proyectos. Para entrar seguirás usando tu correo.</p><button type="submit">Guardar nombre</button><p id="pf-profile-message" role="status"></p>`;
    find('pf-account-content').append(form);
    find('pf-display-name').value = ProjectFlowProfile.name(user);
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (saving) return;
      const name = ProjectFlowProfile.normalize(find('pf-display-name').value);
      if (!ProjectFlowProfile.valid(name)) { find('pf-profile-message').textContent = 'Escribe un nombre o alias de hasta 60 caracteres.'; return; }
      saving = true; pending++; form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
      find('pf-profile-message').textContent = 'Guardando nombre…';
      try {
        const { data, error } = await client.auth.updateUser({ data: { display_name: name } });
        if (error) throw error;
        showProfile(data.user); find('pf-display-name').value = ProjectFlowProfile.name(data.user);
        find('pf-profile-message').textContent = 'Nombre guardado.';
        document.dispatchEvent(new Event('projectflow:profile-saved'));
      } catch { find('pf-profile-message').textContent = 'No se pudo guardar tu nombre. Conservamos lo escrito para que puedas reintentar.'; }
      finally { saving=false; pending--; form.querySelectorAll('input,button').forEach(el=>el.disabled=false); }
    });
  }
  function updateAssigneeNames(state) {
    const names = state?.assignee_names || {};
    if (!equal(projectInfo.assigneeNames, names)) {
      projectInfo.assigneeNames = copy(names);
      document.dispatchEvent(new Event('projectflow:profiles'));
    }
  }
  function sessionBar(user) {
    if (find('pf-session')) return;
    const bar = document.createElement('div');
    bar.id = 'pf-session';
    bar.innerHTML = `<div class="pf-identity"><strong id="pf-role"></strong><span id="pf-email"></span></div>
      <div class="pf-controls">
      <button type="button" id="pf-refresh">Actualizar</button>
      <button type="button" id="pf-previous" hidden>Descargar datos anteriores</button>
      <button type="button" id="pf-open-login">Entrar a mi cuenta</button>
      <button type="button" id="pf-set-password" hidden>Crear o cambiar contraseña</button>
      <button type="button" id="pf-logout" hidden>Salir</button></div>
      <p id="pf-password-feedback" role="status"></p>`;
    find('pf-account-content').append(bar);
    showProfile(user); if (user) profileForm(user);
    find('pf-role').textContent = projectInfo.rolesVersion ? ProjectFlowRoles.labels[projectInfo.role] : canEdit() ? 'Edición autorizada' : 'Solo lectura';
    find('pf-email').textContent = user?.email || 'Puedes consultar sin cuenta';
    find('pf-open-login').hidden = !!user;
    find('pf-logout').hidden = !user;
    find('pf-set-password').hidden = !user;
    if (user) accountPasswordDialog();
    if (user && !canEdit()) status(canSubmit() ? 'Puedes enviar solicitudes desde Proyecto.' : 'Esta cuenta tiene acceso de solo lectura.');
    find('pf-open-login').addEventListener('click', () => {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      document.documentElement.classList.add('pf-locked');
      gate.hidden = false;
      find('pf-login').hidden = false;
      find('pf-cancel-login').hidden = false;
      find('pf-retry').hidden = true;
      message('Entra con la cuenta invitada a este proyecto.');
      find('pf-email-input').focus();
    });
    find('pf-refresh').addEventListener('click', () => {
      if (pending) { status('Espera a que termine el guardado antes de actualizar.'); return; }
      if (dirty.size && !confirm('Hay cambios sin guardar. ¿Descartarlos y cargar los datos compartidos?')) return;
      dirty.clear(); location.reload();
    });
    find('pf-logout').addEventListener('click', async () => {
      if (pending) { status('Espera a que termine el guardado antes de salir.'); return; }
      if (dirty.size && !confirm('Hay cambios sin guardar. ¿Descartarlos y salir?')) return;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { status('No se pudo cerrar la sesión. Vuelve a intentarlo.', true); return; }
      dirty.clear(); location.reload();
    });
    try { find('pf-previous').hidden = !canEdit() || !KEYS.some(key => localStorage.getItem(key)); } catch { /* optional migration */ }
    find('pf-previous').addEventListener('click', downloadPreviousData);
  }
  function accountPasswordDialog() {
    const dialog = document.createElement('dialog'); dialog.id = 'pf-password-dialog';
    dialog.setAttribute('aria-labelledby', 'pf-password-heading');
    dialog.innerHTML = `<form id="pf-password-form"><h2 id="pf-password-heading">Crear o cambiar contraseña</h2>
      <p>Define la contraseña con la que volverás a entrar a ProjectFlow usando tu correo. Es personal; el admin no necesita conocerla.</p>
      <label>Nueva contraseña<input id="pf-new-password" type="password" autocomplete="new-password" minlength="6" required></label>
      <label>Repite la contraseña<input id="pf-confirm-password" type="password" autocomplete="new-password" minlength="6" required></label>
      <p>Usa al menos 6 caracteres.</p><p id="pf-password-error" role="status"></p>
      <div class="pf-project-actions"><button type="button" id="pf-password-close">Cancelar</button><button type="submit">Guardar contraseña</button></div></form>`;
    document.body.append(dialog);
    let savingPassword = false;
    find('pf-set-password').addEventListener('click', () => { find('pf-password-error').textContent = ''; dialog.showModal(); find('pf-new-password').focus(); });
    find('pf-password-close').addEventListener('click', () => { if (!savingPassword) dialog.close(); });
    dialog.addEventListener('cancel', event => { if (savingPassword) event.preventDefault(); });
    dialog.addEventListener('close', () => { find('pf-password-form').reset(); find('pf-password-error').textContent = ''; });
    find('pf-password-form').addEventListener('submit', async event => {
      event.preventDefault(); if (savingPassword) return;
      if (find('pf-new-password').value !== find('pf-confirm-password').value) {
        find('pf-password-error').textContent = 'Las contraseñas no coinciden.'; find('pf-confirm-password').focus(); return;
      }
      savingPassword = true; pending++;
      const controls = dialog.querySelectorAll('input, button'); controls.forEach(control => control.disabled = true);
      find('pf-password-error').textContent = 'Guardando contraseña…';
      try {
        const { error } = await client.auth.updateUser({ password: find('pf-new-password').value });
        if (error) {
          find('pf-password-error').textContent = error.code === 'same_password' ? 'Esa ya es tu contraseña actual. Puedes seguir usándola.'
            : error.code === 'reauthentication_needed' ? 'Vuelve a iniciar sesión para poder cambiar tu contraseña.'
            : 'No se pudo guardar la contraseña. Revisa tu conexión y los requisitos de contraseña y vuelve a intentarlo.';
          return;
        }
        dialog.close(); find('pf-password-feedback').textContent = 'Contraseña guardada. Puedes entrar con tu correo y esta contraseña.';
      } catch { find('pf-password-error').textContent = 'No se pudo guardar la contraseña. Revisa tu conexión y vuelve a intentarlo.'; }
      finally { savingPassword = false; pending--; controls.forEach(control => control.disabled = false); }
    });
  }
  async function unlock(session) {
    const state = await requestState();
    // A fresh login after session expiry must not reuse the previous user's DOM.
    if (find('pf-session')) { dirty.clear(); location.reload(); return; }
    cache = copy(state.data);
    projectId = state.project_id || projectId;
    projectInfo = { id: projectId, name: state.name || cache[KEYS[2]]?.project?.name || 'Proyecto',
      role: stateRole(state), rolesVersion: state.roles_version || 0, scopeVersion: state.scope_version || 1, canManage: !!state.can_manage,
      canInvite: state.roles_version ? !!state.can_invite : !!state.can_manage,
      canCreate: !!state.can_create, assigneeNames: state.assignee_names || {}, multi, signedIn: !!session };
    preserveProjectLinks();
    unlocked = true;
    editor = ['admin', 'pm', 'pm_junior'].includes(projectInfo.role);
    applyAccess();
    sessionBar(session?.user);
    gate.hidden = true;
    find('pf-password').value = '';
    document.documentElement.classList.remove('pf-locked');
    completeReady();
  }
  async function restore() {
    find('pf-retry').hidden = true;
    message('Cargando datos compartidos…');
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      let session = data.session;
      if (session) { const fresh = await client.auth.getUser(); if (!fresh.error && fresh.data.user) session = { ...session, user: fresh.data.user }; }
      await unlock(session);
    } catch (error) {
      find('pf-login').hidden = false;
      find('pf-retry').hidden = false;
      const denied = error?.code === '42501' || error?.status === 401 || error?.status === 403;
      message(error?.code === 'P0002' ? 'El proyecto de este enlace no existe. Revisa la dirección que te compartieron.' : denied ? 'La consulta con el enlace todavía no está disponible. Puedes entrar con una cuenta autorizada.' : 'No se pudieron cargar los datos. Comprueba tu conexión y pulsa Reintentar.', true);
    }
  }
  window.ProjectFlow = Object.freeze({
    ready: () => ready, get, set: (key, value) => setMany({ [key]: value }), setMany, markDirty, clean, canEdit, canSubmit, submitRequest, checkPermissions, applyAccess, normalizeSchedule,
    project: () => ({ ...projectInfo, name: cache[KEYS[2]]?.project?.name || projectInfo.name }), projectUrl, navigate, projectRpc, inviteEditor
  });
  document.addEventListener('projectflow:profile-saved', async () => { try { updateAssigneeNames(await requestState()); } catch { /* Next refresh retries. */ } });
  window.addEventListener('beforeunload', event => {
    if (unlocked && (dirty.size || pending)) { event.preventDefault(); event.returnValue = ''; }
  });
  find('pf-login').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    find('pf-enter').disabled = true; find('pf-login-link').disabled = true;
    message('Entrando…');
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: find('pf-email-input').value.trim(), password: find('pf-password').value
      });
      if (error) { message('No se pudo iniciar sesión. Revisa el correo y la contraseña de tu cuenta de ProjectFlow.', true); return; }
      let session = data.session;
      if (session) { const fresh = await client.auth.getUser(); if (!fresh.error && fresh.data.user) session = { ...session, user: fresh.data.user }; }
      await unlock(session);
    } catch (error) { message(errorText(error), true); }
    finally { find('pf-enter').disabled = false; find('pf-login-link').disabled = false; }
  });
  find('pf-login-link').addEventListener('click', async () => {
    if (!client || find('pf-login-link').disabled || !find('pf-email-input').reportValidity()) return;
    const email = find('pf-email-input').value.trim();
    find('pf-enter').disabled = true; find('pf-login-link').disabled = true;
    message('Solicitando el enlace de acceso…');
    try {
      // Solo autentica una cuenta existente; no crea cuentas ni concede roles.
      const { error } = await client.auth.signInWithOtp({ email,
        options: { shouldCreateUser: false, emailRedirectTo: projectUrl() } });
      if (error) { message('No se pudo solicitar el enlace. Revisa el correo de tu invitación y espera un minuto antes de reintentar.', true); return; }
      find('pf-password').value = '';
      message('Revisa tu correo. Si la cuenta existe, recibirás un enlace para entrar. Después ve a Ajustes → tu perfil → Crear o cambiar contraseña.');
    } catch { message('No se pudo solicitar el enlace. Comprueba tu conexión y vuelve a intentarlo.', true); }
    finally { find('pf-enter').disabled = false; find('pf-login-link').disabled = false; }
  });
  find('pf-retry').addEventListener('click', restore);
  find('pf-cancel-login').addEventListener('click', () => {
    gate.hidden = true;
    find('pf-password').value = '';
    document.documentElement.classList.remove('pf-locked');
  });
  try {
    const config = window.PROJECTFLOW_CONFIG || {};
    const url = new URL(config.supabaseUrl);
    const key = config.supabasePublishableKey || '';
    let publicKey = key.startsWith('sb_publishable_');
    if (!publicKey && key.split('.').length === 3) {
      try { publicKey = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { /* invalid */ }
    }
    if (url.protocol !== 'https:' || !publicKey || !window.supabase) throw new Error('Configuración incompleta');
    client = window.supabase.createClient(url.origin, key);
    client.auth.onAuthStateChange((event, session) => {
      if (canSubmit() && (event === 'SIGNED_OUT' || !session)) lock('La sesión terminó. Pulsa Reintentar para consultar o vuelve a entrar.');
    });
    restore();
    setInterval(async () => {
      if (!unlocked || pending || document.hidden) return;
      try {
        const state = await requestState();
        if (projectInfo.role !== stateRole(state) || projectInfo.rolesVersion !== (state.roles_version || 0) || projectInfo.scopeVersion !== (state.scope_version || 1)) {
          lock('Tus permisos cambiaron. Pulsa Reintentar para cargar el acceso actual.');
          return;
        }
        updateAssigneeNames(state);
        if (!equal(state.data, cache)) {
          if (canEdit() || dirty.size) status('Hay cambios compartidos. Pulsa Actualizar para verlos.');
          else {
            cache = copy(state.data);
            document.dispatchEvent(new Event('projectflow:updated'));
            status('Datos actualizados');
          }
        }
      } catch (error) {
        if (error?.code === '42501' || error?.status === 401 || error?.status === 403) lock(errorText(error));
        else status('No se pudo comprobar si hay cambios. Revisa tu conexión.', true);
      }
    }, 30000);
  } catch {
    message('El acceso compartido todavía no está configurado. Contacta al responsable del proyecto.', true);
  }
})();
