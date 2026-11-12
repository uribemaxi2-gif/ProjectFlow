(() => {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  let resources;
  async function loadResources() {
    if (!resources) resources = Promise.all([
      new Promise((resolve, reject) => {
        if (window.jspdf?.jsPDF) return resolve();
        const script = document.createElement('script');
        script.src = new URL('vendor/jspdf.js', base).href;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar el generador PDF.')); };
        document.head.append(script);
      }),
      fetch(new URL('vendor/NotoSans-Regular.ttf', base)).then(async response => {
        if (!response.ok) throw new Error('No se pudo cargar la fuente del PDF.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      })
    ]).catch(error => { resources = null; throw error; });
    return resources;
  }
  const text = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : text(value) || 'Sin fecha';
  async function create(snapshot) {
    const [, font] = await loadResources();
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.addFileToVFS('NotoSans.ttf', font); doc.addFont('NotoSans.ttf', 'NotoSans', 'normal'); doc.setFont('NotoSans');
    const name = text(snapshot.project.name) || 'Proyecto';
    doc.setProperties({ title: `Respaldo — ${name}`, subject: 'Informe del proyecto', creator: 'ProjectFlow' });
    const margin = 18, width = 174, bottom = 274;
    let y;
    function page() {
      if (y !== undefined) doc.addPage();
      doc.setFillColor(34, 40, 68); doc.rect(0, 0, 210, 20, 'F');
      doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.text('ProjectFlow · Respaldo del proyecto', margin, 13);
      y = 31;
    }
    function room(height) { if (y + height > bottom) page(); }
    function paragraph(value, size = 10.5, color = [45, 52, 68]) {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text(value) || 'Sin registrar', width);
      const step = size * .3528 * 1.5;
      for (const line of lines) {
        room(step); doc.setFontSize(size); doc.setTextColor(...color); doc.text(line, margin, y); y += step;
      }
      y += 2;
    }
    function section(title, count) {
      room(24); y += 4;
      doc.setDrawColor(210, 215, 228); doc.line(margin, y, 192, y); y += 9;
      paragraph(title + (count === undefined ? '' : ` (${count})`), 15, [68, 65, 145]);
    }
    function field(label, value) { paragraph(`${label}: ${text(value) || 'Sin registrar'}`); }
    function record(title) { room(22); y += 3; paragraph(title, 12, [34, 40, 68]); }
    function list(items, render) { if (!items.length) paragraph('Sin registros.'); else items.forEach(render); }
    const role = r => snapshot.roles[r.requestedRole] || 'Cargo no registrado';
    page(); paragraph(name, 22, [34, 40, 68]);
    paragraph('Generado: ' + new Date(snapshot.generatedAt).toLocaleString('es-CL'), 10);
    paragraph('Copia de los datos cargados del proyecto seleccionado. El PDF es para consulta; para restaurar datos en ProjectFlow se utiliza la copia JSON.', 9, [85, 94, 110]);
    section('Ficha del proyecto');
    for (const [key, label] of Object.entries({ client:'Cliente / área', startDate:'Inicio', targetDate:'Entrega', objective:'Objetivo', scope:'Alcance', contacts:'Contactos', notes:'Notas', repository:'Repositorio', demo:'Demo' })) {
      field(label, key.endsWith('Date') ? date(snapshot.project[key]) : snapshot.project[key]);
    }
    section('Agenda', snapshot.agenda.length);
    list(snapshot.agenda, (item, i) => {
      record(`${i + 1}. ${item.title || 'Actividad'}`);
      field('Estado', item.done ? 'Completada' : 'Pendiente'); field('Entrega', date(item.dueDate));
      field('Semana', snapshot.weeks.find(week => week.id === item.weekId)?.title || 'Sin semana asignada');
    });
    section('Plan semanal', snapshot.weeks.length);
    list(snapshot.weeks, (week, i) => {
      record(`${i + 1}. ${week.title || 'Semana'}`);
      field('Inicio', date(week.startDate)); field('Final', date(week.dueDate));
      field('Estado', week.done ? 'Completada' : 'Pendiente'); field('Semana de reserva', week.optional ? 'Sí' : 'No');
      field('Objetivos y plan de trabajo', week.objective);
    });
    section('Solicitudes', snapshot.requests.length);
    list(snapshot.requests, (r, i) => {
      record(`${i + 1}. ${r.title || 'Solicitud'}`);
      field('Estado', r.status); field('Tipo', r.category); field('Prioridad', r.priority);
      field('Solicitante', r.requestedBy); field('Rango del creador', role(r));
      field('Responsable', r.assigneeId ? snapshot.assigneeNames[r.assigneeId] || r.assigneeName || 'Sin alias' : 'Sin asignar');
      field('Fecha de solicitud', date(r.createdDate)); field('Fecha objetivo', date(r.dueDate));
      field('Descripción', r.detail); field('Motivo / resultado esperado', r.benefit); field('Módulo', r.module);
      field('Decisión', r.decision); field('Requiere revisión', r.reviewRequired ? 'Sí' : 'No'); field('Enlace', r.link);
    });
    section('Revisiones', snapshot.reviews.length);
    list(snapshot.reviews, (r, i) => {
      record(`${i + 1}. ${r.title || 'Revisión'}`);
      field('Estado', r.status); field('Urgencia', r.priority); field('Solicitante', r.requestedBy); field('Rango del creador', role(r));
      field('Solicitud relacionada', snapshot.requests.find(item => item.id === r.requestId)?.title || 'Sin solicitud relacionada');
      field('Fecha objetivo', date(r.dueDate)); field('Qué comprobar', r.criteria); field('Resultado y observaciones', r.feedback); field('Enlace', r.link);
    });
    section('Acuerdos y notas', snapshot.agreements.length);
    list(snapshot.agreements, (r, i) => {
      record(`${i + 1}. ${r.title || 'Acuerdo'}`);
      field('Tipo', r.kind); field('Fecha', date(r.date)); field('Participantes / responsable', r.owner);
      field('Contenido', r.description); field('Próximo paso', r.nextAction);
    });
    section('Historial', snapshot.activity.length);
    list(snapshot.activity, (item, i) => {
      record(`${i + 1}. ${item.title || 'Actualización'}`);
      field('Fecha y hora', item.at); field('Tipo', item.kind); field('Detalle', item.detail);
    });
    if (snapshot.legacy.length) {
      section('Asignaciones anteriores', snapshot.legacy.length);
      snapshot.legacy.forEach(([key, value]) => field(`Asignación ${key}`, value));
    }
    const total = doc.getNumberOfPages();
    for (let n = 1; n <= total; n++) {
      doc.setPage(n); doc.setFontSize(9); doc.setTextColor(90, 98, 112);
      doc.text(`Página ${n} de ${total}`, 192, 287, { align: 'right' });
    }
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,70) || 'proyecto';
    return { blob: doc.output('blob'), filename: `respaldo_${slug}_${snapshot.generatedAt.slice(0,10)}.pdf` };
  }
  window.ProjectFlowReport = Object.freeze({ create });
})();
