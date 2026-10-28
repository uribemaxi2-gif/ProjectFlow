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
    <button type="button" id="pf-menu-toggle" aria-controls="pf-navigation" aria-expanded="false"><span aria-hidden="true">☰</span> <span id="pf-menu-label">Abrir menú</span></button>
    <button type="button" id="pf-settings-back" aria-label="Volver al proyecto" hidden><span aria-hidden="true">←</span> Volver</button>
    <div class="pf-context"><strong id="pf-current-project"></strong><span id="pf-status" role="status" aria-live="polite">Datos compartidos</span></div>`;
  layout.before(toolbar);
  const openSettings = document.createElement('button');
  openSettings.type = 'button'; openSettings.id = 'pf-open-settings'; openSettings.className = 'side-link';
  openSettings.innerHTML = `<svg class="pf-gear" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 3-1 3-3 1-2 4 2 2v3l3 3 3-1 3 1 3-3v-3l2-2-2-4-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/></svg> Ajustes`;
  sidebar.querySelector('.side-note').before(openSettings);
  const settings = document.createElement('main');
  settings.id = 'pf-settings'; settings.hidden = true; settings.tabIndex = -1;
  settings.setAttribute('aria-labelledby', 'pf-settings-title');
  settings.innerHTML = `<header class="pf-settings-heading"><span class="pf-settings-kicker">TU ESPACIO</span><h1 id="pf-settings-title">Ajustes</h1><p>Tu cuenta, tu forma de leer y las opciones del proyecto.</p></header>
    <div class="pf-settings-grid">
    <section class="pf-settings-card pf-account-card" aria-labelledby="pf-account-heading"><div class="pf-card-heading"><span class="pf-account-avatar" aria-hidden="true">YO</span><h2 id="pf-account-heading">Mi cuenta</h2></div><div id="pf-account-content"></div></section>
    <section class="pf-settings-card pf-appearance-card" aria-labelledby="pf-appearance-heading"><h2 id="pf-appearance-heading">Apariencia</h2>
      <label class="pf-size-label" for="pf-text-size">Tamaño de letra</label><output id="pf-text-description" for="pf-text-size"></output>
      <input id="pf-text-size" type="range" min="1" max="7" step="1" value="3" aria-describedby="pf-font-help">
      <div class="pf-size-ticks" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span></div>
      <div class="pf-size-ends" aria-hidden="true"><span>Menor</span><span>Mayor</span></div>
      <p id="pf-font-help">El tamaño se aplica a toda la web y se guarda en este navegador.</p>
      <div class="pf-font-preview" aria-label="Vista previa del tamaño de letra"><span class="pf-settings-kicker">VISTA PREVIA</span><h3>Tus proyectos, a tu ritmo</h3><p>Organiza tus actividades, revisa tus fechas y sigue avanzando en lo que te importa.</p></div>
      <button type="button" id="pf-font-reset">Restablecer tamaño</button>
    </section>
    <section class="pf-settings-card pf-project-card" aria-labelledby="pf-project-heading"><h2 id="pf-project-heading">Proyecto y enlace</h2><div id="pf-project-content"></div></section>
    </div>`;
  layout.after(settings);
  toolbar.querySelector('.pf-skip').addEventListener('click', event => {
    event.preventDefault();
    (settings.hidden ? main : settings).focus();
  });
  const toggle = toolbar.querySelector('#pf-menu-toggle');
  const menuLabel = toolbar.querySelector('#pf-menu-label');
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
  close.type = 'button'; close.id = 'pf-menu-close'; close.textContent = 'Cerrar menú';
  sidebar.prepend(close);
  function reflect() {
    const open = compact.matches ? drawer.open : desktopOpen;
    toggle.setAttribute('aria-expanded', String(open));
    menuLabel.textContent = open ? 'Cerrar menú' : 'Abrir menú';
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
