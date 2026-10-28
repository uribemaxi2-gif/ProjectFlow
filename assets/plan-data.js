(() => {
  'use strict';
  const legacy = [
  {name:'Análisis y planificación',short:'Análisis y diseño',objective:'Definir qué quieres construir y establecer las bases antes de programar.',status:'Diseño',work:[['Organización','Anotar requisitos, fijar el alcance y organizar tus tareas y fechas.'],['Interfaz','Diseñar flujo de navegación, wireframes, prototipo y estructura de componentes.'],['Lógica','Definir arquitectura, reglas de negocio, API y criterios de autenticación si aplica.'],['Datos','Crear MER, modelo relacional, restricciones y primeras migraciones.'],['Integración','Preparar GitHub, reglas de ramas, entornos y contratos de API.']],deliverables:['Requisitos y alcance del proyecto definidos.','Prototipo y recorrido principal de usuario.','MER/esquema inicial y endpoints documentados.','Repositorio, agenda y fechas preparados.'],gate:'Al finalizar: alcance y diseño definidos; puedes comenzar el desarrollo.'},
  {name:'Desarrollo principal',short:'Desarrollo',objective:'Construir primero las funcionalidades fundamentales, con integración temprana.',status:'Construcción',work:[['Organización','Verificar tareas, plazos, dependencias y bloqueos.'],['Interfaz','Implementar páginas, formularios, componentes y navegación.'],['Lógica','Crear endpoints, validaciones, servicios y reglas de negocio.'],['Datos','Implementar tablas, migraciones, consultas y datos de prueba.'],['Integración','Conectar el primer flujo real frontend–API–BD y ejecutar pruebas de humo.']],deliverables:['Primer flujo funcional completo, de pantalla a base de datos.','Funcionalidades principales en construcción y demostrables.','Entorno compartido y conexión validada.','Revisión del avance y registro de lo que falta.'],gate:'Al finalizar: existe un recorrido real funcionando, aunque el MVP todavía no esté completo.'},
  {name:'Integración y pruebas',short:'Integración',objective:'Completar el MVP, verificar los flujos principales y preparar una versión para la revisión final.',status:'MVP listo',work:[['Organización','Revisar alcance comprometido y coordinar la revisión final.'],['Interfaz','Completar interfaces, estados de error y usabilidad.'],['Lógica','Cerrar funcionalidades, validaciones y pruebas de endpoints.'],['Datos','Comprobar integridad, migraciones y consistencia de consultas.'],['Integración','Ejecutar pruebas de extremo a extremo, armar versión y preparar la revisión final.']],deliverables:['MVP con funcionalidades comprometidas integradas.','Pruebas internas de los recorridos principales.','Versión de pruebas disponible para revisión final.','Registro de bugs y correcciones priorizadas.'],gate:'Al finalizar: congelar nuevas funcionalidades; desde aquí solo correcciones y estabilidad.'},
  {name:'Estabilización y entrega',short:'Entrega',objective:'Corregir fallas, validar el resultado y entregar una versión estable.',status:'Entrega',work:[['Organización','Coordinar devoluciones de QA, verificación del resultado y cierre.'],['Interfaz','Corregir fallas visuales, de interacción y accesibilidad.'],['Lógica','Resolver errores funcionales, validación, seguridad y API.'],['Datos','Revisar integridad, respaldos y migraciones de producción.'],['Integración','Preparar despliegue, validar entorno final y ejecutar verificación integral.']],deliverables:['Aplicación funcionando en el entorno acordado.','Errores críticos y bloqueantes resueltos.','Documentación de uso y técnica mínima.','Demostración final y verificación del resultado.'],gate:'Al finalizar: la aplicación queda entregada si supera las pruebas y la revisión final.'},
  {name:'Semana de contingencia',short:'Reserva',objective:'Margen reservado para incidentes o ajustes indispensables. No es una quinta semana de nuevas funciones.',status:'Reserva',reserve:true,work:[['Organización','Priorizar bloqueos reales, comunicar fechas y cerrar pendientes de aceptación.'],['Interfaz','Solucionar únicamente incidencias relevantes de interfaz.'],['Lógica','Atender fallas detectadas después de la revisión final.'],['Datos','Resolver problemas de datos, migración o respaldo, si aparecen.'],['Integración','Revalidar correcciones, despliegue y resultado final.']],deliverables:['Errores pendientes de severidad alta corregidos, si los hay.','Retesteo y verificación final.','Documentación y mejoras de uso si no surgen fallas.','Cierre administrativo del proyecto.'],gate:'No planificar funcionalidades nuevas en esta semana: solo contingencias y cierre.'}
 ];
  function normalize(items) {
    if (!Array.isArray(items) || items.length > 104) throw new Error('El plan admite hasta 104 semanas.');
    const ids = new Set();
    const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    return items.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string') throw new Error('Semana no válida.');
      ids.add(item.id);
      const startDate = date(item.startDate), dueDate = date(item.dueDate);
      if (startDate && dueDate && dueDate < startDate) throw new Error('El final de una semana no puede ser anterior a su inicio.');
      return { id: item.id, title: item.title.slice(0,160), objective: String(item.objective || '').slice(0,10000), startDate, dueDate, done: item.done === true, optional: item.optional === true };
    });
  }
  function read() {
    const stored = ProjectFlow.get('equipo14.hitos', {});
    if (stored.weeks !== undefined) return normalize(stored.weeks);
    return legacy.map((week,i) => ({id:String(i+1),title:week.name,
      objective: [week.objective, ...week.work.map(([area,task]) => area + ': ' + task), ...week.deliverables, week.gate].join('\n\n'),
      startDate:'',dueDate:'',done:!!stored[String(i+1)],optional:!!week.reserve}));
  }
  window.ProjectFlowPlan = Object.freeze({normalize,read});
})();
