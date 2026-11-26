const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../supabase/cloud-sync.js'),'utf8');
const factory=fs.readFileSync(path.join(__dirname,'account-isolation.cjs'),'utf8');
const ctx={core:source.slice(source.indexOf('let currentUser ='),source.indexOf('function authMessage(')),console,vm};vm.createContext(ctx);vm.runInContext(factory.slice(factory.indexOf('const clone='),factory.indexOf('(async()=>{')),ctx);
const make=ctx.browser,copy=x=>JSON.parse(JSON.stringify(x)),A='qa-a';
const baseline={clients:[{id:1,name:'Тест конфликта',phone:'+70000000000',note:'Исходная заметка'}],services:[],appointments:[]};
(async()=>{
 const server=new Map([[A,{snapshot:copy(baseline),updated_at:'2026-01-01T00:00:00.000Z'}]]),phone=make(server),laptop=make(server);await phone.hydrate(A);await laptop.hydrate(A);
 const first=copy(baseline);first.clients[0].phone='+70000000011';phone.api.save(first);await phone.flush();
 const second=copy(baseline);second.clients[0].note='Мой введённый текст';laptop.ctx.window.__cabinetCaptureEditor=()=>({fields:{note:second.clients[0].note}});laptop.api.save(second);await laptop.flush();
 assert(laptop.api.hasConflict());assert(laptop.ctx.document.getElementById('cloudConflict'));assert.equal(server.get(A).snapshot.clients[0].phone,'+70000000011');assert.equal(server.get(A).snapshot.clients[0].note,'Исходная заметка');assert(laptop.api.draftText().includes('Мой введённый текст'));
 // Reload must not rebase a stale pending snapshot and silently upload it.
 const reloaded=make(server,laptop.storage);await reloaded.hydrate(A);await reloaded.flush();assert(reloaded.api.hasConflict());assert.equal(reloaded.writes.length,0);assert(reloaded.api.draftText().includes('Мой введённый текст'));
 reloaded.override(async()=>({data:null,error:{message:'offline'}}));assert(!(await reloaded.api.loadLatest()).confirmed);assert(reloaded.storage.has('moikabinet_pending:'+A));assert(reloaded.api.draftText().includes('Мой введённый текст'));
 reloaded.override(null);assert((await reloaded.api.loadLatest()).confirmed);assert.equal(reloaded.ctx.visible.clients[0].phone,'+70000000011');assert(reloaded.api.draftText().includes('Мой введённый текст'));
 const again=make(server,reloaded.storage);await again.hydrate(A);assert(again.ctx.document.getElementById('cloudConflict'));assert(again.api.draftText().includes('Мой введённый текст'));
 // Polling while a form is open preserves its inputs, even before Save.
 const editor=make(server);await editor.hydrate(A);editor.ctx.window.__cabinetHasOpenEditor=()=>true;editor.ctx.window.__cabinetCaptureEditor=()=>({fields:{note:'Ещё не нажала сохранить'}});server.set(A,{snapshot:copy(baseline),updated_at:'2026-02-01T00:00:00.000Z'});await [...editor.polls.values()][0]();assert(editor.api.hasConflict());assert(editor.api.draftText().includes('Ещё не нажала сохранить'));assert.equal(editor.ctx.visible.clients[0].phone,'+70000000011');
 // Own sequential writes may advance; independent captured contexts may not.
 const own=make(server);await own.hydrate(A);const fork=own.api.captureWriteContext();own.api.save(first);await own.flush();own.api.save(second);await own.flush();assert(!own.api.hasConflict());assert.equal(server.get(A).snapshot.clients[0].note,'Мой введённый текст');own.api.save(baseline,fork);await own.flush();assert(own.api.hasConflict());
 // Concurrent first creation must not upsert over the winner.
 const empty=new Map(),a=make(empty),b=make(empty);await a.hydrate(A);await b.hydrate(A);a.api.save(first);await a.flush();b.api.save(second);await b.flush();assert(b.api.hasConflict());assert.equal(empty.get(A).snapshot.clients[0].phone,'+70000000011');
 console.log('PASS: atomic stale-write rejection, first cloud edit retained, typed draft retained, reload cannot overwrite, failed fresh-load retains draft, archive available after reload, open editor polling protected, own sequential saves, independent contexts and concurrent row creation. Mock backend.');
})().catch(e=>{console.error(e);process.exitCode=1});
