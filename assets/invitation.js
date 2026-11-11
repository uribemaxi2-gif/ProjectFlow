(() => {
  'use strict';
  try {
    const saved = localStorage.getItem('projectflow.ui.fontLevel');
    const level = saved === null ? (localStorage.getItem('projectflow.ui.largeText') === 'true' ? 5 : 3) : Number(saved);
    const sizes = [87.5, 93.75, 100, 112.5, 125, 137.5, 150];
    if (Number.isInteger(level) && level >= 1 && level <= 7) document.documentElement.style.fontSize = sizes[level - 1] + '%';
  } catch { /* El acceso no depende de poder guardar preferencias locales. */ }
  const find = id => document.getElementById(id);
  const invitationId = new URL(location.href).searchParams.get('invitation');
  const callbackError = new URLSearchParams(location.hash.slice(1)).get('error');
  let client, invitation, busy = false, passwordReady = false, savedName = '';
  function message(text, error = false) { find('inv-message').textContent = text; find('inv-message').dataset.error = String(error); }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('button').forEach(button => button.disabled = value);
    document.querySelectorAll('input').forEach(input => input.disabled = value);
  }
  function showPassword() {
    const create = document.querySelector('[name="password-mode"]:checked').value === 'new';
    find('inv-password-options').hidden = passwordReady || !invitation?.has_password;
    find('inv-new-password').hidden = passwordReady || !create;
    find('inv-new-password').disabled = passwordReady || !create;
    find('inv-existing-password').hidden = passwordReady || create;
    find('inv-existing-password').disabled = passwordReady || create;
    find('inv-password-ready').hidden = !passwordReady;
  }
  function clearPassword() { find('inv-password').value = ''; find('inv-confirm').value = ''; find('inv-current-password').value = ''; }
  document.querySelectorAll('[name="password-mode"]').forEach(input => input.addEventListener('change', () => { clearPassword(); showPassword(); }));
  async function rpc(name) {
    const { data, error } = await client.rpc(name, { p_invitation_id: invitationId });
    if (error) throw error;
    return data;
  }
  function explain(error) {
    if (error?.code === 'PGRST202') return 'Las invitaciones aún no están activadas. Avisa al propietario para que complete la actualización.';
    if (['42501', '22023'].includes(error?.code)) return error.message;
    return 'No se pudo completar la operación. Revisa tu conexión y vuelve a intentarlo.';
  }
  async function load() {
    invitation = null; passwordReady = false;
    find('inv-login').hidden = true; find('inv-accept').hidden = true; find('inv-retry').hidden = true;
    find('inv-account').hidden = true; clearPassword(); find('inv-display-name').value = ''; savedName = '';
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      find('inv-login').hidden = false;
      message(callbackError ? 'El enlace de acceso venció o ya se usó. Pide que te reenvíen la invitación, o entra con tu cuenta si ya tienes contraseña.' : 'Confirma tu acceso desde el correo de invitación, o entra con tu cuenta para continuar.', !!callbackError);
      return;
    }
    find('inv-account').hidden = false;
    find('inv-email').textContent = data.session.user.email || '';
    invitation = await rpc('projectflow_get_invitation');
    savedName = ProjectFlowProfile.name(data.session.user);
    find('inv-display-name').value = savedName;
    find('inv-project').textContent = invitation.name;
    const role = invitation.role || 'pm_junior';
    find('inv-role').textContent = 'Rol: ' + (ProjectFlowRoles.labels[role] || 'Acceso al proyecto');
    find('inv-permissions').textContent = (ProjectFlowRoles.descriptions[role] || '') + (role === 'admin' ? ' Este rol da acceso a todos los proyectos de la web.' : ' El permiso corresponde únicamente a este proyecto.');
    // Supabase puede guardar una contraseña aleatoria al crear cuentas con OTP.
    // has_password no demuestra que el destinatario conozca esa contraseña.
    document.querySelector('[name="password-mode"][value="new"]').checked = true;
    showPassword();
    find('inv-submit').textContent = invitation.accepted ? 'Entrar al proyecto' : 'Aceptar invitación';
    find('inv-accept').hidden = false;
    message(invitation.accepted ? 'Ya aceptaste esta invitación.' : 'Te invitaron a participar en este proyecto.');
  }
  async function reload() {
    if (busy) return;
    setBusy(true);
    try { await load(); }
    catch (error) { message(explain(error), true); find('inv-retry').hidden = false; }
    finally { setBusy(false); }
  }
  find('inv-login').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, values = new FormData(form);
    setBusy(true);
    try {
      const { error } = await client.auth.signInWithPassword({ email: values.get('email').trim(), password: values.get('password') });
      if (error) { message('No se pudo entrar. Revisa tu correo y contraseña, o pide un nuevo enlace de invitación.', true); return; }
      form.reset(); await load();
      if (invitation) { passwordReady = true; showPassword(); }
    } catch (error) { message(explain(error), true); }
    finally { setBusy(false); }
  });
  find('inv-accept').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !invitation) return;
    const displayName = ProjectFlowProfile.normalize(find('inv-display-name').value);
    if (!ProjectFlowProfile.valid(displayName)) { message('Escribe un nombre o alias de hasta 60 caracteres.', true); find('inv-display-name').focus(); return; }
    const create = document.querySelector('[name="password-mode"]:checked').value === 'new';
    if (!passwordReady && create && find('inv-password').value !== find('inv-confirm').value) {
      message('Las contraseñas no coinciden.', true); find('inv-confirm').focus(); return;
    }
    setBusy(true); message('Guardando tu acceso…');
    try {
      if (!passwordReady) {
        const { error } = create
          ? await client.auth.updateUser({ password: find('inv-password').value })
          : await client.auth.signInWithPassword({ email: invitation.email, password: find('inv-current-password').value });
        if (error) {
          message(create
            ? error.code === 'same_password' ? 'Esa ya es tu contraseña actual. Elige conservarla y confírmala para continuar.' : 'No se pudo guardar la contraseña. Revisa tu conexión y los requisitos de contraseña y vuelve a intentarlo.'
            : 'La contraseña actual no es correcta. Revisa lo escrito o elige crear una nueva.', true);
          return;
        }
        passwordReady = true; clearPassword(); showPassword();
      }
      if (displayName !== savedName) {
        const { error } = await client.auth.updateUser({ data: { display_name: displayName } });
        if (error) { message('No se pudo guardar tu nombre. Vuelve a intentarlo; la invitación sigue pendiente.', true); return; }
        savedName = displayName;
      }
      const accepted = await rpc('projectflow_accept_invitation');
      const destination = new URL('index.html', location.href);
      destination.searchParams.set('project', accepted.project_id);
      location.replace(destination.href);
    } catch (error) { message(explain(error), true); }
    finally { setBusy(false); }
  });
  find('inv-switch').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      await load();
    } catch (error) { message(explain(error), true); }
    finally { setBusy(false); }
  });
  find('inv-retry').addEventListener('click', reload);
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId || '')) throw new Error('Invalid invitation');
    const config = window.PROJECTFLOW_CONFIG;
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
    reload();
  } catch { message('El enlace de invitación está incompleto o no es válido. Pide al propietario que lo envíe de nuevo.', true); }
})();
