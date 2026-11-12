(() => {
  'use strict';
  const root = document.documentElement;
  const layout = document.querySelector('.layout');
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('main');
  if (!layout || !sidebar || !main) return;

  // These preferences affect this browser only, never shared project data.
  const read = key => { try { return localStorage.getItem(`projectflow.ui.${key}`); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(`projectflow.ui.${key}`, value); } catch { /* Optional preference. */ } };
  const compact = matchMedia('(max-width: 64rem)');
  let desktopOpen = read('menu') !== 'closed';
  sidebar.id = 'pf-navigation';
  main.id = 'pf-main';
  main.tabIndex = -1;

  const toolbar = document.createElement('div');
  toolbar.id = 'pf-display';
  toolbar.setAttribute('aria-label', 'Navegación y estado del proyecto');
  toolbar.innerHTML = `<a class="pf-skip" href="#pf-main">Saltar al contenido</a>
    <button type="button" id="pf-menu-toggle" aria-controls="pf-navigation" aria-expanded="false" aria-label="Abrir menú"><svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
    <button type="button" id="pf-settings-back" aria-label="Volver al proyecto" hidden><span aria-hidden="true">←</span> Volver</button>
    <div class="pf-context"><strong id="pf-current-project"></strong><span id="pf-status" role="status" aria-live="polite">Datos compartidos</span></div>`;
  layout.before(toolbar);
  const openSettings = document.createElement('button');
  openSettings.type = 'button'; openSettings.id = 'pf-open-settings'; openSettings.className = 'side-link';
  openSettings.innerHTML = `<svg class="pf-gear" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 3-1 3-3 1-2 4 2 2v3l3 3 3-1 3 1 3-3v-3l2-2-2-4-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/></svg> Ajustes`;
  (sidebar.querySelector('.subnav-wrap') || sidebar.querySelector('nav')).after(openSettings);
  const settings = document.createElement('main');
  settings.id = 'pf-settings'; settings.hidden = true; settings.tabIndex = -1;
  settings.setAttribute('aria-labelledby', 'pf-settings-title');
  settings.innerHTML = `<header class="pf-settings-heading"><h1 id="pf-settings-title">Ajustes</h1><p>Preferencias de cuenta y de la aplicación.</p></header>
    <div class="pf-settings-layout"><nav class="pf-settings-nav" aria-label="Secciones de ajustes">
      <button type="button" data-settings-section="account">Cuenta</button><button type="button" data-settings-section="appearance">Apariencia</button><button type="button" data-settings-section="notices">Avisos</button><button type="button" data-settings-section="security">Seguridad</button><button type="button" data-settings-section="data">Datos</button>
    </nav><div class="pf-settings-panels">
    <section id="pf-panel-account" data-settings-panel="account" class="pf-settings-card pf-account-card" aria-labelledby="pf-account-heading"><div class="pf-card-heading"><span class="pf-account-avatar" aria-hidden="true">PF</span><h2 id="pf-account-heading">Cuenta</h2></div><div id="pf-account-content"></div></section>
    <section id="pf-panel-appearance" data-settings-panel="appearance" class="pf-settings-card pf-appearance-card" aria-labelledby="pf-appearance-heading"><h2 id="pf-appearance-heading">Apariencia</h2>
      <fieldset class="pf-theme-options"><legend>Tema</legend><div><button type="button" data-theme="light">Claro</button><button type="button" data-theme="dark">Oscuro</button><button type="button" data-theme="system">Sistema</button></div></fieldset>
      <label class="pf-size-label" for="pf-text-size">Tamaño de letra</label><output id="pf-text-description" for="pf-text-size"></output>
      <input id="pf-text-size" type="range" min="1" max="7" step="1" value="3" aria-describedby="pf-font-help">
      <div class="pf-size-ticks" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div>
      <div class="pf-size-ends" aria-hidden="true"><span>Menor</span><span>Mayor</span></div>
      <p id="pf-font-help">El tamaño se aplica a toda la web y se guarda en este navegador.</p>
      <button type="button" id="pf-font-reset">Restablecer tamaño</button>
    </section>
    <section id="pf-panel-notices" data-settings-panel="notices" class="pf-settings-card" aria-labelledby="pf-notices-heading"><h2 id="pf-notices-heading">Avisos</h2><figure class="pf-coming-soon pf-franky"><figcaption>FRANKY AÚN ESTÁ TRABAJANDO ACÁ</figcaption><img src="https://i.pinimg.com/1200x/ab/1e/87/ab1e87a9f4691da8c12a43dcefc74d6b.jpg" alt="Franky — sección en preparación" loading="lazy" decoding="async" referrerpolicy="no-referrer"><p>En preparación</p></figure></section>
    <section id="pf-panel-security" data-settings-panel="security" class="pf-settings-card" aria-labelledby="pf-security-heading"><h2 id="pf-security-heading">Seguridad</h2><div id="pf-security-content"></div></section>
    <section id="pf-panel-data" data-settings-panel="data" class="pf-settings-card" aria-labelledby="pf-data-heading"><h2 id="pf-data-heading">Datos</h2><div id="pf-project-content"></div><div id="pf-session-content"></div></section>
    </div></div>`;
  layout.after(settings);
  function selectSection(section) {
    if (!['account','appearance','notices','security','data'].includes(section)) section = 'account';
    settings.querySelectorAll('[data-settings-panel]').forEach(panel => panel.hidden = panel.dataset.settingsPanel !== section);
    settings.querySelectorAll('[data-settings-section]').forEach(button => { button.setAttribute('aria-current', button.dataset.settingsSection === section ? 'page' : 'false'); button.setAttribute('aria-controls', 'pf-panel-' + button.dataset.settingsSection); });
    save('settingsSection', section);
  }
  settings.querySelectorAll('[data-settings-section]').forEach(button => button.addEventListener('click', () => selectSection(button.dataset.settingsSection)));
  selectSection(read('settingsSection'));
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let theme = ['light','dark','system'].includes(read('theme')) ? read('theme') : 'system';
  function applyTheme() {
    root.dataset.theme = theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
    settings.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  }
  settings.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => { theme = button.dataset.theme; save('theme', theme); applyTheme(); }));
  systemTheme.addEventListener('change', applyTheme); applyTheme();
  toolbar.querySelector('.pf-skip').addEventListener('click', event => {
    event.preventDefault();
    (settings.hidden ? main : settings).focus();
  });
  const toggle = toolbar.querySelector('#pf-menu-toggle');
  const textSize = settings.querySelector('#pf-text-size');
  // Keep the sticky navigation clear of the header, including long save errors.
  new ResizeObserver(() => root.style.setProperty('--pf-header-height', `${toolbar.getBoundingClientRect().height}px`)).observe(toolbar);
  const sizes = [87.5, 93.75, 100, 112.5, 125, 137.5, 150];
  const sizeNames = ['Muy pequeño', 'Pequeño', 'Predeterminado', 'Mediano', 'Grande', 'Muy grande', 'Máximo'];
  function applySize(level) {
    root.style.setProperty('--pf-font-scale', `${sizes[level - 1]}%`);
    textSize.value = String(level);
    const description = `Nivel ${level} de 7 · ${sizeNames[level - 1]}`;
    textSize.setAttribute('aria-valuetext', description);
    settings.querySelector('#pf-text-description').textContent = description;
  }
  const savedLevel = read('fontLevel');
  applySize(/^[1-7]$/.test(savedLevel || '') ? Number(savedLevel) : read('largeText') === 'true' ? 5 : 3);
  textSize.addEventListener('input', () => {
    const level = Number(textSize.value);
    applySize(level); save('fontLevel', String(level));
  });
  settings.querySelector('#pf-font-reset').addEventListener('click', () => { applySize(3); save('fontLevel', '3'); });

  // A native modal keeps keyboard focus in the mobile menu and supports Escape.
  // Move the existing navigation: its links, permissions and listeners stay intact.
  const drawer = document.createElement('dialog');
  drawer.id = 'pf-menu-dialog';
  drawer.setAttribute('aria-label', 'Menú de navegación');
  document.body.append(drawer);
  const close = document.createElement('button');
  close.type = 'button'; close.id = 'pf-menu-close'; close.innerHTML = toggle.innerHTML; close.setAttribute('aria-label', 'Cerrar menú');
  sidebar.prepend(close);
  function reflect() {
    const open = compact.matches ? drawer.open : desktopOpen;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    root.classList.toggle('pf-menu-open', drawer.open);
  }
  function adapt() {
    if (drawer.open) drawer.close();
    if (compact.matches) {
      drawer.append(sidebar);
      sidebar.hidden = false;
    } else {
      layout.prepend(sidebar);
      sidebar.hidden = !desktopOpen;
    }
    layout.classList.toggle('pf-menu-collapsed', compact.matches || !desktopOpen);
    reflect();
  }
  toggle.addEventListener('click', () => {
    if (compact.matches) {
      if (drawer.open) drawer.close();
      else { drawer.showModal(); close.focus(); }
      reflect();
    } else {
      desktopOpen = !desktopOpen;
      save('menu', desktopOpen ? 'open' : 'closed');
      adapt();
    }
  });
  close.addEventListener('click', () => drawer.close());
  drawer.addEventListener('close', reflect);
  drawer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...drawer.querySelectorAll('a[href], button:not([disabled]), select:not([disabled]), summary')]
      .filter(el => el.getClientRects().length && !el.closest('details:not([open]) > :not(summary)'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  drawer.addEventListener('click', event => {
    const rect = drawer.getBoundingClientRect();
    if (event.target === drawer && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) drawer.close();
  });
  sidebar.addEventListener('click', event => {
    if (drawer.open && event.target.closest('.side-link')) {
      drawer.close();
      // Let the page's delegated click handler render the selected section first.
      if (event.target.closest('button[data-page]')) queueMicrotask(() => main.focus({ preventScroll: true }));
    }
  });
  const back = toolbar.querySelector('#pf-settings-back');
  const pageTitle = document.title;
  let previousScroll = 0;
  function showSettings(focus = false) {
    const active = location.hash === '#ajustes';
    if (drawer.open) drawer.close();
    settings.hidden = !active;
    root.classList.toggle('pf-settings-open', active);
    toggle.hidden = active; back.hidden = !active;
    toolbar.querySelector('.pf-skip').href = active ? '#pf-settings' : '#pf-main';
    openSettings.setAttribute('aria-current', active ? 'page' : 'false');
    document.title = active ? 'Ajustes — ProjectFlow' : pageTitle;
    if (focus) {
      (active ? settings : main).focus({ preventScroll: true });
      window.scrollTo({ top: active ? 0 : previousScroll, behavior: 'instant' });
    }
  }
  openSettings.addEventListener('click', () => {
    previousScroll = window.scrollY;
    history.pushState({ ...history.state, pfSettings: true }, '', '#ajustes');
    showSettings(true);
  });
  back.addEventListener('click', () => {
    if (history.state?.pfSettings) history.back();
    else {
      history.replaceState(history.state, '', location.pathname + location.search);
      showSettings(true);
    }
  });
  window.addEventListener('popstate', () => showSettings(true));
  window.addEventListener('hashchange', () => showSettings());
  compact.addEventListener('change', adapt);
  adapt();
  showSettings();
})();
