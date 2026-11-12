import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

test('dispatch authenticates callers and sends only to supported push providers',async()=>{
 const endpoints=[
  'https://fcm.googleapis.com/fcm/send/test',
  'https://updates.push.services.mozilla.com/wpush/v2/test',
  'https://updates-autopush.push.services.mozilla.com/wpush/v2/test',
  'https://web.push.apple.com/test',
  'http://fcm.googleapis.com/test',
  'https://fcm.googleapis.com.evil.example/test',
  'https://fcmXgoogleapis.com/test',
  'https://localhost/test',
  'https://user:password@fcm.googleapis.com/test',
  'https://fcm.googleapis.com:8443/test'
 ];
 const sent=[];let handler,claims=0;
 const db={
  rpc:async name=>name==='projectflow_claim_push'
   ?(claims++,{data:[{id:'event',user_id:'user',project_id:'project',kind:'created'}]})
   :{data:'admin'},
  from:()=>({
   select:()=>({eq:async()=>({data:endpoints.map(endpoint=>({endpoint,subscription:{endpoint}}))})}),
   update:()=>({eq:async()=>({})})
  })
 };
 const source=await readFile(new URL('../supabase/functions/push-dispatch/index.ts',import.meta.url),'utf8');
 vm.runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')),{
  URL,Response,createClient:()=>db,
  webpush:{setVapidDetails:()=>{},sendNotification:async subscription=>sent.push(subscription.endpoint)},
  Deno:{env:{get:name=>name==='PUSH_DISPATCH_SECRET'?'test-secret':'test'},serve:fn=>handler=fn}
 });
 assert.equal((await handler(new Request('https://example.com',{method:'POST'}))).status,401);
 assert.equal(claims,0);
 const response=await handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer test-secret'}}));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{sent:4});
 assert.deepEqual(sent,endpoints.slice(0,4));
});

test('dispatch diagnostics identify configuration and SQL failures without leaking secrets',async()=>{
 const source=stripTypeScriptTypes((await readFile(new URL('../supabase/functions/push-dispatch/index.ts',import.meta.url),'utf8')).replace(/^import .*;\n/gm,''));
 for(const scenario of ['missing','vapid','queue']){
  let handler;const logs=[];
  vm.runInNewContext(source,{
   URL,Response,console:{error:(...args)=>logs.push(args)},
   createClient:()=>({rpc:async()=>({error:{code:'PGRST202',message:'DO-NOT-LEAK'}})}),
   webpush:{setVapidDetails:()=>{if(scenario==='vapid')throw new Error('DO-NOT-LEAK');}},
   Deno:{env:{get:name=>name==='PUSH_DISPATCH_SECRET'?'test-secret':scenario==='missing'&&name==='VAPID_PRIVATE_KEY'?undefined:'DO-NOT-LEAK'},serve:fn=>handler=fn}
  });
  const response=await handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer test-secret'}}));
  assert.equal(response.status,500);
  const body=await response.json();
  if(scenario==='missing')assert.deepEqual(body,{error:'missing_configuration',missing:['VAPID_PRIVATE_KEY']});
  else assert.deepEqual(body,{error:'push_dispatch_failed',stage:scenario==='vapid'?'vapid_configuration':'claim_queue',code:scenario==='queue'?'PGRST202':null});
  assert.ok(logs.length);
  assert.ok(!JSON.stringify({body,logs}).includes('DO-NOT-LEAK'));
 }
});
