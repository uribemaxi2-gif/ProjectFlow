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
  let client, cache = {}, unlocked = false, conflict = false, queue = Promise.resolve(), pending = 0;
  const dirty = new Map();
  let generation = 0, completeReady;
  const ready = new Promise(resolve => { completeReady = resolve; });
  const gate = document.createElement('section');
  gate.id = 'pf-gate';
  gate.innerHTML = `<div class="pf-card"><h1>ProjectFlow</h1>
    <p>Acceso privado para líderes y responsables del proyecto.</p>
    <form id="pf-login" hidden>
      <label for="pf-email-input">Correo</label><input id="pf-email-input" type="email" autocomplete="username" required>
      <label for="pf-password">Contraseña</label><input id="pf-password" type="password" autocomplete="current-password" required>
      <button type="submit" id="pf-enter">Entrar</button>
    </form>
    <p id="pf-message" role="status" aria-live="polite">Comprobando acceso…</p>
    <button id="pf-retry" type="button" hidden>Reintentar</button>
    <p>Si necesitas una cuenta o recuperar el acceso, contacta al responsable del proyecto.</p>
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
    cache = {};
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.documentElement.classList.add('pf-locked');
    gate.hidden = false;
    find('pf-login').hidden = false;
    message(text, true);
  }
  function markDirty(key) { dirty.set(key, ++generation); status('Cambios sin guardar'); }
  function clean(key) { dirty.delete(key); }
  function errorText(error) {
    if (error?.code === '40001') return 'Otra persona guardó cambios. Conserva lo que escribiste y pulsa Actualizar antes de volver a guardar.';
    if (error?.code === '42501' || error?.status === 401 || error?.status === 403) return 'Tu cuenta no tiene acceso. Contacta al responsable del proyecto.';
    return 'No se pudo conectar o guardar. Comprueba tu conexión y vuelve a intentarlo. Tus cambios todavía no están compartidos.';
  }
  async function requestState() {
    const { data, error } = await client.rpc('projectflow_get_state');
    if (error) throw error;
    if (!data || !['leader', 'responsible'].includes(data.role) || !data.data || typeof data.data !== 'object') {
      throw new Error('Estado no válido');
    }
    return data;
  }
  function get(key, fallback) {
    if (!unlocked) throw new Error('Inicia sesión para acceder.');
    return copy(Object.hasOwn(cache, key) ? cache[key] : fallback);
  }
  function setMany(values) {
    if (!unlocked) return Promise.reject(new Error('Inicia sesión para guardar.'));
    const snapshot = copy(values), versions = new Map();
    for (const key of Object.keys(snapshot)) {
      if (!KEYS.includes(key)) return Promise.reject(new Error('Sección no válida.'));
      markDirty(key); versions.set(key, dirty.get(key));
    }
    pending++;
    const task = queue.catch(() => {}).then(async () => {
      try {
        if (conflict) throw { code: '40001' };
        if (!unlocked) throw { code: '42501' };
        status('Guardando…');
        const updates = Object.entries(snapshot).map(([key, value]) => ({
          key, expected: Object.hasOwn(cache, key) ? copy(cache[key]) : null, value
        }));
        const { error } = await client.rpc('projectflow_save', { p_updates: updates });
        if (error) throw error;
        // Only advance baselines for the sections we actually wrote. Advancing
        // another section could hide changes that its visible form never saw.
        for (const [key, value] of Object.entries(snapshot)) {
          cache[key] = copy(value);
          if (dirty.get(key) === versions.get(key)) clean(key);
        }
        status('Guardado para el equipo');
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
      status('Respaldo descargado. Puedes importarlo desde Datos del proyecto → Ficha del proyecto.');
    } catch { status('No se pudieron leer los datos anteriores de este navegador.', true); }
  }
  function sessionBar(user, role) {
    if (find('pf-session')) return;
    const bar = document.createElement('div');
    bar.id = 'pf-session';
    bar.innerHTML = `<div class="pf-identity"><strong id="pf-role"></strong><span id="pf-email"></span></div>
      <div class="pf-controls"><span id="pf-status" role="status" aria-live="polite">Datos compartidos</span>
      <button type="button" id="pf-refresh">Actualizar</button>
      <button type="button" id="pf-previous" hidden>Descargar datos anteriores</button>
      <button type="button" id="pf-logout">Salir</button></div>`;
    document.body.insertBefore(bar, gate.nextSibling);
    find('pf-role').textContent = role === 'leader' ? 'Líder' : 'Responsable';
    find('pf-email').textContent = user.email || '';
    find('pf-refresh').addEventListener('click', () => {
      if (pending) { status('Espera a que termine el guardado antes de actualizar.'); return; }
      if (dirty.size && !confirm('Hay cambios sin guardar. ¿Descartarlos y cargar los datos del equipo?')) return;
      dirty.clear(); location.reload();
    });
    find('pf-logout').addEventListener('click', async () => {
      if (pending) { status('Espera a que termine el guardado antes de salir.'); return; }
      if (dirty.size && !confirm('Hay cambios sin guardar. ¿Descartarlos y salir?')) return;
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) { status('No se pudo cerrar la sesión. Vuelve a intentarlo.', true); return; }
      dirty.clear(); location.reload();
    });
    try { find('pf-previous').hidden = !KEYS.some(key => localStorage.getItem(key)); } catch { /* optional migration */ }
    find('pf-previous').addEventListener('click', downloadPreviousData);
  }
  async function unlock(session) {
    const state = await requestState();
    // A fresh login after session expiry must not reuse the previous user's DOM.
    if (find('pf-session')) { dirty.clear(); location.reload(); return; }
    cache = copy(state.data);
    unlocked = true;
    sessionBar(session.user, state.role);
    gate.hidden = true;
    find('pf-password').value = '';
    document.documentElement.classList.remove('pf-locked');
    completeReady();
  }
  async function restore() {
    find('pf-retry').hidden = true;
    message('Comprobando acceso…');
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session) await unlock(data.session);
      else { find('pf-login').hidden = false; message('Ingresa con tu cuenta autorizada.'); }
    } catch (error) {
      find('pf-login').hidden = false;
      find('pf-retry').hidden = false;
      message(errorText(error), true);
    }
  }
  window.ProjectFlow = Object.freeze({
    ready: () => ready, get, set: (key, value) => setMany({ [key]: value }), setMany, markDirty, clean
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
      if (unlocked && (event === 'SIGNED_OUT' || !session)) lock('La sesión terminó. Vuelve a iniciar sesión.');
    });
    restore();
    setInterval(async () => {
      if (!unlocked || pending || document.hidden) return;
      try {
        const state = await requestState();
        if (!equal(state.data, cache)) status('Hay cambios del equipo. Pulsa Actualizar para verlos.');
      } catch (error) {
        if (error?.code === '42501' || error?.status === 401 || error?.status === 403) lock(errorText(error));
        else status('No se pudo comprobar si hay cambios. Revisa tu conexión.', true);
      }
    }, 30000);
  } catch {
    message('El acceso compartido todavía no está configurado. Contacta al responsable del proyecto.', true);
  }
})();
