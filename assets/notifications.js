(async()=>{
 'use strict';
 await ProjectFlow.ready();
 const panel=document.getElementById('pf-panel-notices');
 panel.innerHTML='<h2>Avisos</h2><p>Recibe menciones y, si eres admin global, avisos de nuevas solicitudes, revisiones y acuerdos creados por otras personas, incluso con la pestaña cerrada.</p><button type="button" id="pf-push-enable">Activar en este dispositivo</button><button type="button" id="pf-push-disable" hidden>Desactivar en este dispositivo</button><p id="pf-push-status" role="status"></p>';
 const on=document.getElementById('pf-push-enable'),off=document.getElementById('pf-push-disable'),status=document.getElementById('pf-push-status');
 const key=window.PROJECTFLOW_CONFIG?.pushPublicKey;
 let registration;
 const message=text=>status.textContent=text;
 async function current(){ registration=await navigator.serviceWorker.register(new URL('push-worker.js',location.href),{scope:new URL('.',location.href).pathname});await navigator.serviceWorker.ready;return registration.pushManager.getSubscription(); }
 async function disable(){
  const subscription=await current();
  if(subscription){await ProjectFlow.projectRpc('projectflow_push_subscribe',{p_subscription:subscription.toJSON(),p_enabled:false});await subscription.unsubscribe();}
  off.hidden=true;message('Avisos desactivados en este dispositivo.');
 }
 if(!ProjectFlow.project().signedIn){on.disabled=true;message('Inicia sesión desde Datos para activar los avisos.');return;}
 if(!window.isSecureContext||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){on.disabled=true;message('Este navegador no admite avisos push. Prueba Chrome en Android.');return;}
 if(!key){on.disabled=true;message('Falta completar la configuración de notificaciones en Supabase. Todavía no se envían avisos.');return;}
 window.ProjectFlowPush=Object.freeze({disable});
 try{off.hidden=!(await current());}catch{message('No se pudo preparar el dispositivo. Inténtalo de nuevo.');}
 on.addEventListener('click',async()=>{
  on.disabled=true;
  try{
   const permission=await Notification.requestPermission();
   if(permission!=='granted'){message('No se concedió permiso. Puedes cambiarlo en los permisos del navegador.');return;}
   let subscription=await current();
   if(!subscription){const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/'));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});}
   await ProjectFlow.projectRpc('projectflow_push_subscribe',{p_subscription:subscription.toJSON(),p_enabled:true});
   off.hidden=false;message('Este dispositivo quedó registrado para recibir avisos.');
  }catch{message('No se pudieron activar los avisos. Comprueba que el SQL y la clave pública estén configurados.');}
  finally{on.disabled=false;}
 });
 off.addEventListener('click',async()=>{off.disabled=true;try{await disable();}catch{message('No se pudo desactivar. Inténtalo de nuevo.');}finally{off.disabled=false;}});
})();
