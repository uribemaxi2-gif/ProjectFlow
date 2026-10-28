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
  toolbar.setAttribute('aria-label', 'Navegación y lectura');
  toolbar.innerHTML = `<a class="pf-skip" href="#pf-main">Saltar al contenido</a>
    <button type="button" id="pf-menu-toggle" aria-controls="pf-navigation" aria-expanded="false"><span aria-hidden="true">☰</span> <span id="pf-menu-label">Abrir menú</span></button>
    <button type="button" id="pf-text-size" aria-pressed="false">Texto grande</button>`;
  layout.before(toolbar);
  const toggle = toolbar.querySelector('#pf-menu-toggle');
  const menuLabel = toolbar.querySelector('#pf-menu-label');
  const textSize = toolbar.querySelector('#pf-text-size');
  function largeText(enabled) {
    root.classList.toggle('pf-large-text', enabled);
    textSize.setAttribute('aria-pressed', String(enabled));
  }
  largeText(read('largeText') === 'true');
  textSize.addEventListener('click', () => {
    const enabled = !root.classList.contains('pf-large-text');
    largeText(enabled); save('largeText', String(enabled));
  });

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
    const controls = [...drawer.querySelectorAll('a[href], button:not([disabled])')].filter(el => el.getClientRects().length);
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
  compact.addEventListener('change', adapt);
  adapt();
})();
