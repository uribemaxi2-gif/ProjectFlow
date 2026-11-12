import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
const allowed = (endpoint: string) => {
  try { const u=new URL(endpoint); return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com)$/.test(u.hostname)); } catch { return false; }
};
Deno.serve(async request => {
  const secret=Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || request.headers.get('authorization')!==`Bearer ${secret}`) return new Response('Unauthorized',{status:401});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!,Deno.env.get('VAPID_PUBLIC_KEY')!,Deno.env.get('VAPID_PRIVATE_KEY')!);
    const {data:jobs,error}=await db.rpc('projectflow_claim_push'); if(error)throw error;
    let sent=0;
    for(const job of jobs||[]){
      const {data:role,error:roleError}=await db.rpc('projectflow_user_role',{p_project_id:job.project_id,p_user_id:job.user_id});
      if(roleError)continue;
      if(!['qa','pm_junior','pm','admin'].includes(role)||(job.kind==='created'&&role!=='admin')){await db.from('projectflow_push_queue').update({sent_at:new Date().toISOString()}).eq('id',job.id);continue;}
      const {data:devices,error:deviceError}=await db.from('projectflow_push_subscriptions').select('endpoint,subscription').eq('user_id',job.user_id);
      if(deviceError)continue;
      let retry=false;
      await Promise.all((devices||[]).map(async device=>{
        if(!allowed(device.endpoint))return;
        try{
          await webpush.sendNotification(device.subscription,JSON.stringify({id:job.id,title:'ProjectFlow',body:job.kind==='mention'?'Te mencionaron en un proyecto.':'Hay un nuevo registro para revisar.',project:job.project_id}),{TTL:3600,timeout:5000});sent++;
        }catch(e){
          if([404,410].includes((e as {statusCode?:number}).statusCode || 0))await db.from('projectflow_push_subscriptions').delete().eq('endpoint',device.endpoint);
          else retry=true;
        }
      }));
      if(!retry)await db.from('projectflow_push_queue').update({sent_at:new Date().toISOString()}).eq('id',job.id);
    }
    return Response.json({sent});
  }catch{return new Response('Push dispatch failed',{status:500});}
});
