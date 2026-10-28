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
    <p>Consulta el espacio con el enlace. Para agregar o editar datos, entra con una cuenta autorizada.</p>
    <form id="pf-login" hidden>
      <label for="pf-email-input">Correo</label><input id="pf-email-input" type="email" autocomplete="username" required>
      <label for="pf-password">Contraseña</label><input id="pf-password" type="password" autocomplete="current-password" required>
      <button type="submit" id="pf-enter">Entrar</button>
    </form>
    <p id="pf-message" role="status" aria-live="polite">Cargando datos compartidos…</p>
    <button id="pf-retry" type="button" hidden>Reintentar</button>
    <button id="pf-cancel-login" type="button" hidden>Volver a consultar</button>
    <p>El propietario autoriza las cuentas que pueden editar.</p>
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
  function applyAccess(root = document) {
    document.documentElement.classList.toggle('pf-readonly', !canEdit());
    root.querySelectorAll('[data-pf-field], [data-pf-form] input, [data-pf-form] textarea, [data-pf-form] select').forEach(field => {
      if (field.matches('select, [type=checkbox], [type=file], [type=radio]')) field.disabled = !canEdit();
      else field.readOnly = !canEdit();
      field.setAttribute('aria-readonly', String(!canEdit()));
    });
  }
  function markDirty(key) { if (canEdit()) { dirty.set(key, ++generation); status('Cambios sin guardar'); } }
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
    if (!data || !['leader', 'responsible', 'viewer'].includes(data.role) || !data.data || typeof data.data !== 'object' || Array.isArray(data.data)) throw new Error('Estado no válido');
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
    if (error) throw new Error(error.message || errorText(error));
    return data;
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
        const { error } = await client.rpc(multi ? 'projectflow_save_project' : 'projectflow_save', multi ? { p_project_id: projectId, p_updates: updates } : { p_updates: updates });
        if (error) throw error;
        // Only advance baselines for the sections we actually wrote. Advancing
        // another section could hide changes that its visible form never saw.
        for (const [key, value] of Object.entries(snapshot)) {
          cache[key] = copy(value);
          if (dirty.get(key) === versions.get(key)) clean(key);
        }
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
      status('Respaldo descargado. Puedes importarlo desde Mi proyecto → Ficha del proyecto.');
    } catch { status('No se pudieron leer los datos anteriores de este navegador.', true); }
  }
  function sessionBar(user) {
    if (find('pf-session')) return;
    const bar = document.createElement('div');
    bar.id = 'pf-session';
    bar.innerHTML = `<div class="pf-identity"><strong id="pf-role"></strong><span id="pf-email"></span></div>
      <div class="pf-controls"><span id="pf-status" role="status" aria-live="polite">Datos compartidos</span>
      <button type="button" id="pf-refresh">Actualizar</button>
      <button type="button" id="pf-previous" hidden>Descargar datos anteriores</button>
      <button type="button" id="pf-open-login">Entrar para editar</button>
      <button type="button" id="pf-logout" hidden>Salir</button></div>`;
    document.body.insertBefore(bar, gate.nextSibling);
    find('pf-role').textContent = canEdit() ? 'Edición autorizada' : 'Solo lectura';
    find('pf-email').textContent = user?.email || 'Puedes consultar sin cuenta';
    find('pf-open-login').hidden = !!user;
    find('pf-logout').hidden = !user;
    if (user && !canEdit()) status('Esta cuenta tiene acceso de solo lectura.');
    find('pf-open-login').addEventListener('click', () => {
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      document.documentElement.classList.add('pf-locked');
      gate.hidden = false;
      find('pf-login').hidden = false;
      find('pf-cancel-login').hidden = false;
      find('pf-retry').hidden = true;
      message('Entra con la cuenta que el propietario autorizó para editar.');
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
  async function unlock(session) {
    const state = await requestState();
    // A fresh login after session expiry must not reuse the previous user's DOM.
    if (find('pf-session')) { dirty.clear(); location.reload(); return; }
    cache = copy(state.data);
    projectId = state.project_id || projectId;
    projectInfo = { id: projectId, name: state.name || cache[KEYS[2]]?.project?.name || 'Mi proyecto', canManage: !!state.can_manage, canCreate: !!state.can_create, multi, signedIn: !!session };
    preserveProjectLinks();
    unlocked = true;
    editor = ['leader', 'responsible'].includes(state.role);
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
      await unlock(data.session);
    } catch (error) {
      find('pf-login').hidden = false;
      find('pf-retry').hidden = false;
      const denied = error?.code === '42501' || error?.status === 401 || error?.status === 403;
      message(error?.code === 'P0002' ? 'El proyecto de este enlace no existe. Revisa la dirección que te compartieron.' : denied ? 'La consulta con el enlace todavía no está disponible. Puedes entrar con una cuenta autorizada.' : 'No se pudieron cargar los datos. Comprueba tu conexión y pulsa Reintentar.', true);
    }
  }
  window.ProjectFlow = Object.freeze({
    ready: () => ready, get, set: (key, value) => setMany({ [key]: value }), setMany, markDirty, clean, canEdit, applyAccess, normalizeSchedule,
    project: () => ({ ...projectInfo, name: cache[KEYS[2]]?.project?.name || projectInfo.name }), projectUrl, navigate, projectRpc
  });
  window.addEventListener('beforeunload', event => {
    if (unlocked && (dirty.size || pending)) { event.preventDefault(); event.returnValue = ''; }
  });
  find('pf-login').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    find('pf-enter').disabled = true;
    message('Entrando…');
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: find('pf-email-input').value.trim(), password: find('pf-password').value
      });
      if (error) { message('No se pudo iniciar sesión. Revisa el correo y la contraseña de tu cuenta de ProjectFlow.', true); return; }
      await unlock(data.session);
    } catch (error) { message(errorText(error), true); }
    finally { find('pf-enter').disabled = false; }
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
      if (canEdit() && (event === 'SIGNED_OUT' || !session)) lock('La sesión terminó. Pulsa Reintentar para consultar o vuelve a entrar para editar.');
    });
    restore();
    setInterval(async () => {
      if (!unlocked || pending || document.hidden) return;
      try {
        const state = await requestState();
        if (canEdit() !== ['leader', 'responsible'].includes(state.role)) {
          lock('Tus permisos cambiaron. Pulsa Reintentar para cargar el acceso actual.');
          return;
        }
        if (!equal(state.data, cache)) {
          if (canEdit()) status('Hay cambios compartidos. Pulsa Actualizar para verlos.');
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
