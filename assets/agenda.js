(async () => {
  'use strict';
  await ProjectFlow.ready();
  const KEY = 'equipo14.personas'; // Preserve existing backups and storage.
  const find = id => document.getElementById(id);
  let original, items, timer;
  const defaults = ['Definir el objetivo', 'Anotar requisitos y pendientes', 'Diseñar la solución', 'Desarrollar las tareas', 'Revisar y probar', 'Preparar la entrega'];
  function load() {
    original = ProjectFlow.get(KEY, {});
    items = original.schedule === undefined
      ? defaults.map((title, i) => ({ id: String(i + 1), title, dueDate: '', done: false }))
      : ProjectFlow.normalizeSchedule(original.schedule);
  }
  function counters() {
    find('agenda-total').textContent = items.length;
    find('agenda-dated').textContent = items.filter(item => item.dueDate).length;
    find('agenda-done').textContent = items.filter(item => item.done).length;
  }
  async function persist() {
    if (!ProjectFlow.canEdit()) return;
    try { await ProjectFlow.set(KEY, { ...original, schedule: ProjectFlow.normalizeSchedule(items) }); }
    catch (error) {
      find('toast').textContent = error.message;
      find('toast').classList.add('show');
      setTimeout(() => find('toast').classList.remove('show'), 4000);
    }
  }
  function changed() {
    if (!ProjectFlow.canEdit()) return;
    ProjectFlow.markDirty(KEY);
    clearTimeout(timer);
    counters();
    timer = setTimeout(persist, 450);
  }
  function control(row, text, type, item, key) {
    const label = document.createElement('label');
    label.textContent = text;
    const input = document.createElement('input');
    input.type = type;
    input.id = `agenda-${key}-${item.id}`;
    input.dataset.pfField = '';
    if (type === 'checkbox') { input.checked = item[key]; label.className = 'agenda-complete'; }
    else { input.value = item[key]; if (type === 'text') { input.maxLength = 160; label.className = 'agenda-title'; } }
    input.addEventListener('input', () => {
      if (!ProjectFlow.canEdit()) return;
      item[key] = type === 'checkbox' ? input.checked : input.value;
      changed();
    });
    label.append(input);
    row.append(label);
  }
  function render() {
    const list = find('agenda-list');
    list.replaceChildren();
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'agenda-row';
      control(row, 'Actividad', 'text', item, 'title');
      control(row, 'Fecha prevista', 'date', item, 'dueDate');
      const weekLabel = document.createElement('label'), weekSelect = document.createElement('select');
      weekLabel.textContent = 'Semana'; weekSelect.dataset.pfField = ''; weekSelect.id = `agenda-week-${item.id}`;
      weekSelect.add(new Option('Sin semana', ''));
      for (const week of ProjectFlowPlan.read()) weekSelect.add(new Option(week.title || 'Sin título', week.id));
      weekSelect.value = item.weekId || '';
      weekSelect.addEventListener('change', () => { if (ProjectFlow.canEdit()) { item.weekId = weekSelect.value; changed(); } });
      weekLabel.append(weekSelect); row.append(weekLabel);
      control(row, 'Completada', 'checkbox', item, 'done');
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'action-btn'; remove.dataset.pfEdit = '';
      remove.textContent = 'Eliminar'; remove.setAttribute('aria-label', `Eliminar ${item.title || 'actividad'}`);
      remove.addEventListener('click', () => {
        if (!ProjectFlow.canEdit() || !confirm(`¿Eliminar la actividad «${item.title || 'Sin título'}»?`)) return;
        items = items.filter(other => other.id !== item.id);
        render(); changed();
      });
      row.append(remove); list.append(row);
    });
    find('agenda-empty').hidden = items.length !== 0;
    counters(); ProjectFlow.applyAccess();
    const legacy = Object.entries(original).filter(([key, value]) => /^\d+$/.test(key) && typeof value === 'string' && value.trim());
    find('previous-assignments').hidden = legacy.length === 0;
    find('previous-assignment-list').replaceChildren(...legacy.map(([key, value]) => {
      const li = document.createElement('li'); li.textContent = `${key}: ${value}`; return li;
    }));
  }
  find('agenda-add').addEventListener('click', () => {
    if (!ProjectFlow.canEdit() || items.length >= 500) return;
    const item = { id: crypto.randomUUID(), title: '', dueDate: '', done: false };
    items.push(item); render(); changed(); find(`agenda-title-${item.id}`).focus();
  });
  find('export-csv').addEventListener('click', () => {
    const cell = value => '"' + String(value).replace(/"/g, '""') + '"';
    const rows = [['Actividad', 'Fecha prevista', 'Completada'], ...items.map(item => [item.title, item.dueDate, item.done ? 'Sí' : 'No'])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'mi-agenda.csv';
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('projectflow:updated', () => { load(); render(); });
  load(); render();
})();
