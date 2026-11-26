const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../supabase/cloud-sync.js'),'utf8');
const core=source.slice(source.indexOf('let currentUser ='),source.indexOf('function authMessage('));
const clone=x=>JSON.parse(JSON.stringify(x));
const A='qa-a',B='qa-b',legacyOwner='aaa22552-7bad-4c95-afd3-22d25bab743c';
const example=label=>({clients:[{id:label,name:label}],services:[{id:label,name:label}],appointments:[{id:label,clientId:label}]});
function browser(server,storage=new Map()){
 const nodes=new Map(),timers=new Map(),polls=new Map(),writes=[];let n=0,readOverride;
 const node=()=>{const children=new Map(),handlers=new Map();return{style:{},dataset:{},disabled:false,append(){},querySelector(key){if(!children.has(key))children.set(key,node());return children.get(key)},addEventListener(event,handler){handlers.set(event,handler)},click(){if(!this.disabled)return handlers.get('click')?.()},setAttribute(){},focus(){},remove(){}}};
 const context={cfg:{legacyOwnerId:legacyOwner},window:{},document:{getElementById(id){return nodes.get(id)||null},createElement(){const el=node();el.remove=()=>nodes.delete(el.id);return el},head:{append(){}},body:{append(el){nodes.set(el.id,el)}}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},sessionStorage:{removeItem(){}},setStatus(){},setTimeout(fn){timers.set(++n,fn);return n},clearTimeout(id){timers.delete(id)},setInterval(fn){polls.set(++n,fn);return n},clearInterval(id){polls.delete(id)},Promise,Date,JSON,console};
 context.window.__cabinetGetData=()=>context.visible;
 context.window.__cabinetActivate=(id,value)=>{context.visible={clients:[],services:[],appointments:[],...clone(value)};context.active=id;if(id)storage.set('moikabinet_v1:'+id,JSON.stringify(context.visible))};
 context.supabase={auth:{async signOut(){return{error:null}}},from(){return{select(){return{eq(column,id){return{async maybeSingle(){if(readOverride)return readOverride(id);return{data:clone(server.get(id)||null),error:null}}}}}},async upsert(row){writes.push(clone(row));server.set(row.user_id,{snapshot:clone(row.snapshot),updated_at:row.updated_at});return{error:null}}}}};
 vm.createContext(context);vm.runInContext(core+';window.qa={hydrate,startPolling,resetAccount,getEpoch:()=>accountEpoch};',context);
 return{ctx:context,storage,writes,polls,timers,api:context.window.CABINET_SYNC,hydrate:id=>context.window.qa.hydrate(id?{id}:null),override(fn){readOverride=fn},async flush(){for(const [id,fn]of [...timers]){timers.delete(id);await fn()}}};
}
(async()=>{
 const server=new Map([[A,{snapshot:example('A-private'),updated_at:'2026-01-01T00:00:00Z'}]]);
 const one=browser(server);await one.hydrate(A);assert.equal(one.ctx.visible.clients[0].name,'A-private');
 const pending=example('A-pending');one.api.markPending(JSON.stringify(pending));one.api.save(pending);
 await one.hydrate(B);assert.equal(one.ctx.visible.clients.length,0);await one.flush();assert.equal(one.writes.length,0,'old delayed save must be cancelled');
 assert(!JSON.stringify(one.ctx.visible).includes('A-private'));assert(!one.ctx.document.getElementById('cloudSetup'),'B cannot import A cache');
 const bRecord=example('B-private');one.ctx.window.__cabinetActivate(B,bRecord);one.api.markPending(JSON.stringify(bRecord));one.api.save(bRecord);await one.flush();assert.equal(server.get(B).snapshot.clients[0].name,'B-private');assert.equal(server.get(A).snapshot.clients[0].name,'A-private');
 await one.api.signOut();assert.equal(one.ctx.visible.clients.length,0);assert.equal(one.api.canWrite(),false);assert(one.ctx.document.getElementById('cloudGate'));
 await one.hydrate(A);await one.flush();assert.equal(one.ctx.visible.clients[0].name,'A-pending');assert.equal(server.get(A).snapshot.clients[0].name,'A-pending');
 const two=browser(server);await two.hydrate(B);assert.equal(two.ctx.visible.clients[0].name,'B-private','second browser fetches own cloud data');await two.hydrate(A);assert.equal(two.ctx.visible.clients[0].name,'A-pending');
 let release;one.override(()=>new Promise(resolve=>release=resolve));const oldRead=one.hydrate(A);await one.hydrate(null);release({data:{snapshot:example('stale-A'),updated_at:'2099'},error:null});await oldRead;assert.equal(one.ctx.visible.clients.length,0,'stale hydrate cannot reveal old account');
 one.override(async()=>({data:null,error:{message:'offline'}}));await one.hydrate(B);assert.equal(one.api.canWrite(),false);assert.equal(one.ctx.visible.clients.length,0);assert(one.ctx.document.getElementById('cloudLoadGate'),'failed load shows retry screen');assert(!one.ctx.document.getElementById('cloudGate'),'saved session must not ask for password again');
 const retry=one.ctx.document.getElementById('cloudLoadGate').querySelector('#cloudLoadRetry');assert.equal(retry.textContent,'Повторить загрузку');assert.equal(retry.disabled,false);
 let retryReads=0,resolveRetry;one.override(()=>{retryReads++;return new Promise(resolve=>resolveRetry=resolve)});
 const retryTask=retry.click();retry.click();assert.equal(retryReads,1,'Repeated click must not duplicate request');assert(one.ctx.document.getElementById('cloudLoadGate').querySelector('#cloudLoadRetry').disabled);
 resolveRetry({data:clone(server.get(B)),error:null});await retryTask;assert.equal(one.ctx.visible.clients[0].name,'B-private');assert(!one.ctx.document.getElementById('cloudLoadGate'));assert(one.api.canWrite());
 one.override(async()=>({data:null,error:{message:'offline'}}));await one.hydrate(B);const staleRetry=one.ctx.document.getElementById('cloudLoadGate').querySelector('#cloudLoadRetry');await one.api.signOut();staleRetry.click();assert.equal(one.api.canWrite(),false);assert(one.ctx.document.getElementById('cloudGate'));assert(!one.ctx.document.getElementById('cloudLoadGate'));
 const legacy=browser(new Map(),new Map([['moikabinet_legacy:'+legacyOwner,JSON.stringify(example('legacy-owner'))]]));await legacy.hydrate(B);assert.equal(legacy.ctx.visible.clients.length,0);await legacy.hydrate(legacyOwner);assert.equal(legacy.ctx.visible.clients[0].name,'legacy-owner');assert(legacy.ctx.document.getElementById('cloudSetup'));assert.equal(legacy.writes.length,0,'legacy not uploaded automatically');
 // A poll that finishes after switching users must also be ignored.
 const p=browser(server);await p.hydrate(A);p.override(()=>new Promise(resolve=>release=resolve));const polling=[...p.polls.values()][0]();p.override(null);await p.hydrate(B);release({data:{snapshot:example('late-poll-A'),updated_at:'2099'},error:null});await polling;assert.equal(p.ctx.visible.clients[0].name,'B-private');
 // An older queued write must not replace a newer unsent edit in recovery storage.
 const q=browser(server);await q.hydrate(A);let finishWrite;
 q.ctx.supabase.from=()=>({async upsert(){return new Promise(resolve=>finishWrite=()=>resolve({error:null}))}});
 const older=example('older'),newer=example('newer');
 q.api.markPending(JSON.stringify(older));q.api.save(older);const sending=q.flush();await Promise.resolve();await Promise.resolve();
 q.api.markPending(JSON.stringify(newer));finishWrite();await sending;
 assert.equal(JSON.parse(q.storage.get('moikabinet_pending:'+A)).clients[0].name,'newer');
 console.log('PASS: A/B isolation, logout clearing, cancelled delayed save, pending own recovery, second browser own snapshot, stale hydration/poll ignored, failed load locked, legacy restricted to known owner, newer pending edit preserved. Backend is mocked; live RLS not asserted.');
})().catch(e=>{console.error(e);process.exitCode=1});
