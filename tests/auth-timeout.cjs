const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../supabase/cloud-sync.js'),'utf8');
const functions=source.slice(source.indexOf('function requestTimeoutMessage('),source.indexOf('const supabase ='));
async function timeout(input){
 let callback,calls=0,cleared=false;
 const context={cfg:{url:'https://example.supabase.co'},URL,AbortController,setTimeout(fn,ms){assert.equal(ms,15000);callback=fn;return 1},clearTimeout(){cleared=true},async fetch(_input,options){calls++;callback();assert(options.signal.aborted);throw new Error('aborted')}};
 vm.createContext(context);vm.runInContext(functions,context);
 let message='';try{await context.authFetch(input)}catch(e){message=e.message}
 assert.equal(calls,1,'No automatic retries');assert(cleared);return message;
}
(async()=>{
 const url='https://example.supabase.co/auth/v1/';
 const password=await timeout(url+'token?grant_type=password');assert(password.includes('Вход не подтверждён'));assert(!/письм|почт/i.test(password));
 const requestObject=await timeout({url:url+'token?grant_type=password'});assert.equal(requestObject,password);
 for(const path of ['recover','otp','resend'])assert((await timeout(url+path)).includes('Статус отправки письма неизвестен'));
 for(const path of ['token?grant_type=refresh_token','user','../rest/v1/cabinet_state'])assert(!/письм|почт/i.test(await timeout(url+path)));
 let calls=0;const caller=new AbortController();caller.abort();const original=new Error('Caller cancelled');
 const context={cfg:{url},URL,AbortController,setTimeout(){return 1},clearTimeout(){},async fetch(_input,options){calls++;assert(options.signal.aborted);throw original}};
 vm.createContext(context);vm.runInContext(functions,context);
 await assert.rejects(context.authFetch(url+'token',{signal:caller.signal}),e=>e===original);assert.equal(calls,1);
 console.log('PASS: password and refresh timeouts do not mention mail; recovery timeout preserves unknown-mail warning; generic requests neutral; caller cancellation preserved; single request, timers cleaned.');
})().catch(e=>{console.error(e);process.exitCode=1});
