(async () => {
  'use strict';
  await ProjectFlow.ready();
  const KEY = 'equipo14.hitos', TEAM = 'equipo14.personas';
  const find = id => document.getElementById(id);
  let weeks = ProjectFlowPlan.read(), selected = weeks[0]?.id, timer, saving = false;
  const current = () => weeks.find(week => week.id === selected);
  const errorMessage = error => { find('toast').textContent = error.message; find('toast').classList.add('show'); setTimeout(() => find('toast').classList.remove('show'), 4500); };
  function planData() {
    const value = { ...ProjectFlow.get(KEY, {}), weeks: ProjectFlowPlan.normalize(weeks) };
    // Keep the historical checkboxes coherent in old backups.
    for (const week of weeks) if (/^[1-4]$/.test(week.id)) value[week.id] = week.done;
    return value;
  }
  async function persist(extra = {}) {
    if (!ProjectFlow.canEdit()) return false;
    try { await ProjectFlow.setMany({ [KEY]: planData(), ...extra }); return true; }
    catch (error) { errorMessage(error); return false; }
  }
  function progress() {
    const counted = weeks.filter(week => !week.optional), complete = counted.filter(week => week.done).length;
    const percentage = counted.length ? Math.round(complete * 100 / counted.length) : 0;
    find('progress-percent').textContent = percentage + '%'; find('progress-fill').style.width = percentage + '%';
    find('progress-count').textContent = `${complete} de ${counted.length} semanas completadas`;
    find('plan-count').textContent = `${weeks.length} semanas · Fechas y tareas independientes por proyecto`;
  }
  function render() {
    const week = current();
    find('plan-empty').hidden = weeks.length > 0; find('plan-detail').hidden = !week;
    find('plan-weeks').replaceChildren(...weeks.map((item,i) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.weekId = item.id;
      button.textContent = `${i+1}. ${item.title || 'Sin título'}`; button.setAttribute('aria-pressed', String(item.id === selected));
      button.addEventListener('click', () => { selected = item.id; render(); }); return button;
    }));
    if (week) {
      find('week-title-input').value = week.title; find('week-start').value = week.startDate; find('week-due').value = week.dueDate;
      find('week-objective-input').value = week.objective; find('week-done').checked = week.done; find('week-optional').checked = week.optional;
      const tasks = ProjectFlow.get(TEAM, {}).schedule || [];
      const assigned = tasks.filter(task => task.weekId === week.id);
      find('week-tasks').replaceChildren(...(assigned.length ? assigned.map(task => {
        const li = document.createElement('li'); li.textContent = `${task.done ? '✓ ' : ''}${task.title || 'Sin título'}${task.dueDate ? ' · Entrega: ' + task.dueDate : ''}`; return li;
      }) : [Object.assign(document.createElement('li'), { textContent: 'Sin tareas asignadas. Elige esta semana en Mi agenda.' })]));
    }
    find('plan-agenda-link').href = ProjectFlow.projectUrl(undefined, 'index.html');
    progress(); ProjectFlow.applyAccess();
  }
  for (const [id,key] of [['week-title-input','title'],['week-start','startDate'],['week-due','dueDate'],['week-objective-input','objective'],['week-done','done'],['week-optional','optional']]) {
    find(id).addEventListener('input', event => {
      if (!ProjectFlow.canEdit() || saving || !current()) return;
      current()[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      ProjectFlow.markDirty(KEY); progress(); clearTimeout(timer); timer = setTimeout(() => persist(), 450);
      if (key === 'title') { const index = weeks.indexOf(current()); find('plan-weeks').children[index].textContent = `${index+1}. ${current().title || 'Sin título'}`; }
    });
  }
  find('plan-add').addEventListener('click', () => {
    if (!ProjectFlow.canEdit() || saving || weeks.length >= 104) return;
    const week = { id: crypto.randomUUID(), title: `Semana ${weeks.length+1}`, objective: '', startDate:'', dueDate:'', done:false, optional:false };
    weeks.push(week); selected = week.id; ProjectFlow.markDirty(KEY); clearTimeout(timer); render(); persist();
  });
  find('plan-remove').addEventListener('click', async () => {
    if (!ProjectFlow.canEdit() || saving || !current() || !confirm('¿Eliminar esta semana? Sus tareas conservarán sus fechas y quedarán sin semana asignada.')) return;
    saving = true; clearTimeout(timer);
    const previous = weeks, previousId = selected;
    const team = ProjectFlow.get(TEAM, {}), tasks = team.schedule || [];
    const extra = tasks.some(task => task.weekId === selected) ? { [TEAM]: { ...team, schedule: tasks.map(task => task.weekId === selected ? { ...task, weekId:'' } : task) } } : {};
    weeks = weeks.filter(week => week.id !== selected);
    if (!(await persist(extra))) weeks = previous;
    selected = weeks.some(week => week.id === previousId) ? previousId : weeks[0]?.id;
    saving = false; render();
  });
  document.addEventListener('projectflow:updated', () => { weeks = ProjectFlowPlan.read(); if (!current()) selected = weeks[0]?.id; render(); });
  render();
})();
