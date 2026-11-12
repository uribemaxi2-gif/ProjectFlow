import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('service worker displays background push and only opens its own project URL',async()=>{
 const events={},messages=[],opened=[];
 const context={URL,clients:{openWindow:async url=>opened.push(url)},self:{addEventListener:(name,fn)=>events[name]=fn,registration:{scope:'https://example.com/ProjectFlow/',showNotification:async(...args)=>messages.push(args)}}};
 vm.runInNewContext(await readFile(new URL('../push-worker.js',import.meta.url),'utf8'),context);
 let promise;
 events.push({data:{json:()=>({id:'n1',body:'Te mencionaron',project:'10000000-0000-0000-0000-000000000001'})},waitUntil:p=>promise=p});await promise;
 assert.equal(messages[0][1].tag,'projectflow-n1');
 events.notificationclick({notification:{data:{project:''},close(){}},waitUntil:p=>promise=p});await promise;
 assert.equal(opened[0],'https://example.com/ProjectFlow/proyecto.html');
 events.push({data:{json:()=>({id:'n2',project:'https://evil.example/'})},waitUntil:p=>promise=p});await promise;
 assert.equal(messages[1][1].data.project,'');
});
