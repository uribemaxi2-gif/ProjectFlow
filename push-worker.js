self.addEventListener('push',event=>{
 let data;try{data=event.data.json();}catch{return;}
 event.waitUntil(self.registration.showNotification('ProjectFlow',{
  body:data.body||'Hay novedades en un proyecto.',tag:'projectflow-'+data.id,
  data:{project:/^[a-f0-9-]{36}$/i.test(data.project||'')?data.project:''}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('proyecto.html',self.registration.scope);
 if(event.notification.data?.project)url.searchParams.set('project',event.notification.data.project);
 event.waitUntil(clients.openWindow(url.href));
});
