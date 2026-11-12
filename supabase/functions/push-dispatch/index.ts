import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
const allowed = (endpoint: string) => {
  try { const u=new URL(endpoint); return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com)$/.test(u.hostname)); } catch { return false; }
};
Deno.serve(async request => {
  const secret=Deno.env.get('PUSH_DISPATCH_SECRET');
  if (!secret || request.headers.get('authorization')!==`Bearer ${secret}`) return new Response('Unauthorized',{status:401});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405});
  const missing=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VAPID_SUBJECT','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY'].filter(name=>!Deno.env.get(name)?.trim());
  if(missing.length){
    console.error('push-dispatch: missing configuration',missing);
    return Response.json({error:'missing_configuration',missing},{status:500});
  }
  let stage='database_client';
  try {
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    stage='vapid_configuration';
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!,Deno.env.get('VAPID_PUBLIC_KEY')!,Deno.env.get('VAPID_PRIVATE_KEY')!);
    stage='claim_queue';
    const {data:jobs,error}=await db.rpc('projectflow_claim_push'); if(error)throw error;
    stage='dispatch';
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
          else {
            retry=true;
            console.error('push-dispatch: provider rejected notification',{status:Number((e as {statusCode?:number}).statusCode)||0});
          }
        }
      }));
      if(!retry)await db.from('projectflow_push_queue').update({sent_at:new Date().toISOString()}).eq('id',job.id);
    }
    return Response.json({sent});
  }catch(error){
    // Never log raw exceptions: providers can include subscriptions or credentials.
    const rawCode=(error as {code?:unknown})?.code;
    const code=typeof rawCode==='string'&&/^[A-Z0-9]{3,12}$/.test(rawCode)?rawCode:null;
    console.error('push-dispatch failed',{stage,code});
    return Response.json({error:'push_dispatch_failed',stage,code},{status:500});
  }
});
