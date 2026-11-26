const cfg = window.CABINET_SUPABASE_CONFIG;
const statusId = 'cloudStatus';
const setStatus = (text, error = false) => { const node = document.getElementById(statusId); if (node) { node.textContent = text; node.dataset.error = error ? '1' : '0'; } };
const status=document.createElement('div'); status.id=statusId; status.textContent='Supabase: подключаюсь…'; document.body.append(status);
if (!cfg?.url || !cfg?.publishableKey) {
  setStatus('Не заполнены настройки подключения Supabase.',true);
  throw new Error('Не заполнены настройки Supabase.');
}
function showSdkLoadError(error){
  setStatus('Не удалось загрузить подключение Supabase. Проверь интернет или VPN.',true);
  if(document.getElementById('cloudSdkError'))return;
  const box=document.createElement('div');box.id='cloudSdkError';
  box.innerHTML='<div style="width:min(460px,100%);padding:24px;border-radius:22px;background:#eff8fd;color:#123653;box-shadow:0 20px 60px #0006"><h2>Не удалось подключить вход</h2><p>Кабинет открылся, но модуль авторизации Supabase не загрузился. Проверь подключение к интернету и попробуй открыть кабинет ещё раз.</p><p><button id="cloudSdkRetry" type="button" style="padding:12px 18px;border:0;border-radius:10px;background:#14517c;color:white;font:inherit">Повторить загрузку</button></p><small>Данные остаются только в этом браузере; в облако ничего не отправлено.</small></div>';
  Object.assign(box.style,{position:'fixed',inset:'0',zIndex:'10000',display:'grid',placeItems:'center',padding:'20px',background:'#071d31ef'});document.body.append(box);
  box.querySelector('#cloudSdkRetry').addEventListener('click',()=>location.reload());
  console.warn('Supabase SDK could not be loaded from the configured CDNs.',error);
}
async function loadCreateClient(){
  let lastError;
  for(const source of ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm','https://esm.sh/@supabase/supabase-js@2']){
    try{const sdk=await Promise.race([import(source),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Timed out while loading Supabase SDK.')),7000))]);if(typeof sdk.createClient==='function')return sdk.createClient;lastError=new Error('Supabase SDK did not export createClient.');}
    catch(error){lastError=error;}
  }
  showSdkLoadError(lastError);throw lastError;
}
const createClient=await loadCreateClient();
function requestTimeoutMessage(input){
  let path='';
  try{path=new URL(typeof input==='string'||input instanceof URL?input:input.url,cfg.url).pathname;}catch{}
  if(/\/auth\/v1\/(recover|otp|resend)$/.test(path))return 'Нет ответа сервера за 15 секунд. Статус отправки письма неизвестен. Проверь почту; не отправляй запрос повторно сразу.';
  if(path.endsWith('/auth/v1/token'))return 'Сервер входа не ответил за 15 секунд. Вход не подтверждён. Попробуй войти позже.';
  return 'Нет ответа сервера за 15 секунд. Результат запроса не подтверждён. Попробуй позже.';
}
async function authFetch(input, options = {}) {
  const controller = new AbortController();
  let timedOut=false;
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, {once:true});
  const timeout = setTimeout(() => {timedOut=true;controller.abort();}, 15000);
  try { return await fetch(input, {...options, signal:controller.signal}); }
  catch (error) {
    if (timedOut) throw new Error(requestTimeoutMessage(input));
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
const supabase = createClient(cfg.url, cfg.publishableKey, { global: {fetch: authFetch}, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } });
let currentUser = null, timer = 0, poller = 0, applyingRemote = false, syncEnabled = false, lastCloudUpdate = '';
let accountEpoch = 0, accountReady = false, authEventVersion = 0, restoreBusy = false;
let writeQueue=Promise.resolve();
let syncConflict=false,editContext=null,normalBranch='',branchCounter=0;
const branchVersions=new Map();
const metaKey=id=>'moikabinet_pending_version:'+id;
const conflictKey=id=>'moikabinet_conflict:'+id;
const formDraftKey=id=>'moikabinet_form_draft:'+id;
const archiveKey=id=>'moikabinet_conflict_archive:'+id;
const stableSnapshot=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function freshContext(version=lastCloudUpdate||null){return{id:currentUser?.id,epoch:accountEpoch,baseVersion:version,branch:globalThis.crypto?.randomUUID?.()||String(Date.now())+':'+(++branchCounter)}}
function adoptVersion(version){lastCloudUpdate=version||'';const context=freshContext(version||null);normalBranch=context.branch;branchVersions.set(normalBranch,version||null);editContext=null;}
function normalContext(){return editContext||{id:currentUser?.id,epoch:accountEpoch,baseVersion:lastCloudUpdate||null,branch:normalBranch};}
function expectedVersion(context){return branchVersions.has(context.branch)?branchVersions.get(context.branch):context.baseVersion;}
function captureEditorDraft(context=normalContext()){
  if(!currentUser||!isCurrent(context.id,context.epoch))return null;
  const draft=window.__cabinetCaptureEditor?.();if(!draft)return null;
  const value={...draft,baseVersion:expectedVersion(context),savedAt:new Date().toISOString()};
  localStorage.setItem(formDraftKey(currentUser.id),JSON.stringify(value));return value;
}
function draftText(){
  if(!currentUser)return'';
  const id=currentUser.id,archive=readJson(archiveKey(id));
  const form=readJson(formDraftKey(id))||archive?.form;
  if(form?.fields)return Object.entries(form.fields).map(([key,value])=>key+': '+value).join('\n');
  const raw=localStorage.getItem(pendingKey(id))||archive?.snapshotJSON;
  if(!raw)return'';
  try{return JSON.stringify(JSON.parse(raw),null,2)}catch{return raw;}
}
function conflictPanel(archived=false){
  if(!currentUser)return;
  document.getElementById('cloudConflict')?.remove();
  const id=currentUser.id,epoch=accountEpoch,wrap=document.createElement('div');wrap.id='cloudConflict';wrap.setAttribute('role','alert');
  Object.assign(wrap.style,{position:'fixed',right:'12px',bottom:'88px',zIndex:'10003',width:'min(460px,calc(100vw - 24px))',boxSizing:'border-box',maxHeight:'65vh',overflowY:'auto',padding:'18px',borderRadius:'16px',background:'#fff4dc',color:'#493713',boxShadow:'0 8px 30px #0005'});
  wrap.innerHTML='<strong id="cloudConflictTitle"></strong><p id="cloudConflictMessage" style="line-height:1.5"></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="cloudDraftShow" class="btn light" type="button">Мои правки</button><button id="cloudFreshLoad" class="btn light" type="button">Загрузить свежую версию</button><button id="cloudConflictClose" class="btn light" type="button">Закрыть</button></div><textarea id="cloudConflictDraft" readonly hidden aria-label="Сохранённые правки" style="width:100%;min-height:150px;margin-top:12px;box-sizing:border-box"></textarea>';
  wrap.querySelector('#cloudConflictTitle').textContent=archived?'Свежая версия загружена':'Данные изменились на другом устройстве';
  wrap.querySelector('#cloudConflictMessage').textContent=archived?'Предыдущий введённый текст сохранён отдельно. Открой «Мои правки», чтобы перенести нужные изменения.':'Сохранение в облако остановлено: эта версия устарела. Ваши правки сохранены на этом устройстве. Перед продолжением загрузите свежую версию.';
  wrap.querySelector('#cloudFreshLoad').hidden=archived;
  wrap.querySelector('#cloudDraftShow').addEventListener('click',()=>{if(!isCurrent(id,epoch))return;const text=wrap.querySelector('#cloudConflictDraft');text.value=draftText();text.hidden=false;});
  wrap.querySelector('#cloudFreshLoad').addEventListener('click',async()=>{if(!isCurrent(id,epoch))return;const button=wrap.querySelector('#cloudFreshLoad');button.disabled=true;const result=await loadLatest();if(!result.confirmed&&isCurrent(id,epoch)){wrap.querySelector('#cloudConflictMessage').textContent=result.error;button.disabled=false;}});
  wrap.querySelector('#cloudConflictClose').addEventListener('click',()=>wrap.remove());document.body.append(wrap);
}
function flagConflict(id,baseVersion,serverVersion=null){
  syncConflict=true;clearTimeout(timer);timer=0;
  try{captureEditorDraft();localStorage.setItem(conflictKey(id),JSON.stringify({baseVersion,serverVersion,time:new Date().toISOString()}));}catch{}
  setStatus('Конфликт версий: правки сохранены локально, облако не перезаписано.',true);conflictPanel();
}
function markPendingVersion(serialized,context=normalContext()){
  if(!context||!isCurrent(context.id,context.epoch)||!accountReady)throw new Error('Аккаунт сменился или ещё не загружен.');
  captureEditorDraft(context);
  if(!syncConflict)localStorage.setItem(metaKey(context.id),JSON.stringify({...context,baseVersion:expectedVersion(context)}));
  localStorage.setItem(pendingKey(context.id),serialized);
}
async function loadLatest(){
  if(!currentUser||!accountReady||restoreBusy)return{confirmed:false,error:'Дождись загрузки аккаунта.'};
  const id=currentUser.id,epoch=accountEpoch;
  try{
    captureEditorDraft();
    const archive={snapshotJSON:localStorage.getItem(pendingKey(id)),form:readJson(formDraftKey(id)),version:readJson(metaKey(id)),savedAt:new Date().toISOString()};
    const prior=localStorage.getItem(archiveKey(id));if(prior)localStorage.setItem(archiveKey(id)+':'+Date.now(),prior);
    localStorage.setItem(archiveKey(id),JSON.stringify(archive));
    const {data:row,error}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',id).maybeSingle();
    if(!isCurrent(id,epoch))return{confirmed:false,error:'Аккаунт сменился.'};
    if(error)throw error;if(!row?.snapshot)throw new Error('Облачная копия не найдена. Ваши правки сохранены локально.');
    clearTimeout(timer);timer=0;localStorage.removeItem(pendingKey(id));localStorage.removeItem(metaKey(id));localStorage.removeItem(conflictKey(id));localStorage.removeItem(formDraftKey(id));
    syncConflict=false;adoptVersion(row.updated_at);applySnapshot(id,row.snapshot);setStatus('Свежая версия загружена. Предыдущие правки сохранены отдельно.');conflictPanel(true);return{confirmed:true};
  }catch(error){return{confirmed:false,error:'Свежую версию не удалось загрузить: '+error.message+'. Ваши правки не удалены.'};}
}
document.addEventListener?.('input',()=>{if(currentUser&&accountReady){try{captureEditorDraft()}catch{setStatus('Не удалось сохранить черновик. Скопируй введённый текст перед закрытием.',true)}}},true);

const getData = () => window.__cabinetGetData?.();
const setData = value => window.__cabinetSetData?.(value);
const cacheKey = id => 'moikabinet_v1:'+id;
const pendingKey = id => 'moikabinet_pending:'+id;
function isCurrent(id, epoch){return currentUser?.id===id&&accountEpoch===epoch;}
function resetAccount(user=null){
  try{captureEditorDraft()}catch{}
  ++accountEpoch; accountReady=false; syncEnabled=false; applyingRemote=false;
  restoreBusy=false;syncConflict=false;editContext=null;normalBranch='';branchVersions.clear();
  clearTimeout(timer);timer=0;clearInterval(poller);poller=0;lastCloudUpdate='';
  currentUser=user;
  document.getElementById('cloudSetup')?.remove();
  document.getElementById('passwordSetup')?.remove();
  document.getElementById('cloudLoadGate')?.remove();
  document.getElementById('cloudConflict')?.remove();
  window.__cabinetActivate?.(null,{});
}
function applySnapshot(id,snapshot){
  applyingRemote=true;
  try{window.__cabinetActivate(id,snapshot);}finally{applyingRemote=false;}
}
// Recovery links open in a new tab. sessionStorage is isolated per tab, so
// remember only this UI intent (never credentials) across tabs of this origin.
function markPasswordSetup(){localStorage.setItem('cabinet_password_setup',String(Date.now()));}
function wantsPasswordSetup(){
  const stamp=Number(localStorage.getItem('cabinet_password_setup'));
  return Number.isFinite(stamp)&&stamp>0&&Date.now()-stamp>=0&&Date.now()-stamp<3600000;
}
function clearPasswordSetup(){localStorage.removeItem('cabinet_password_setup');sessionStorage.removeItem('cabinet_password_setup');}
const gate = () => {
  if (document.getElementById('cloudGate')) return;
  const wrap = document.createElement('div'); wrap.id = 'cloudGate';
  wrap.innerHTML = `<div class="cloud-card"><h2>Вход в «Мой кабинет»</h2><p>Войди один раз на этом устройстве. Кабинет сохранит вход в этом браузере.</p><form id="cloudLogin"><label for="cloudEmail">Электронная почта</label><input id="cloudEmail" type="email" autocomplete="username" required><label for="cloudPassword">Пароль</label><input id="cloudPassword" type="password" autocomplete="current-password" required><button class="btn gold" type="submit">Войти</button></form><button id="cloudReset" class="btn light" type="button">Установить или восстановить пароль</button><p id="cloudMsg" role="status" aria-live="polite"></p><small>Пароль нужен только для первого входа или после выхода из аккаунта.</small></div>`;
  Object.assign(wrap.style,{position:'fixed',inset:'0',zIndex:'9999',display:'grid',placeItems:'center',padding:'20px',background:'#071d31eF',overflowY:'auto'});
  const style=document.createElement('style');style.textContent='#cloudGate .cloud-card{width:min(460px,100%);padding:24px;border-radius:22px;background:#eff8fd;color:#123653;box-shadow:0 20px 60px #0006}#cloudGate h2{margin-top:0}#cloudGate p,#cloudGate small{line-height:1.55}#cloudGate form{display:grid;gap:12px}#cloudGate input{padding:12px;border:1px solid #9bbbd0;border-radius:10px;font:inherit}#cloudStatus{position:fixed;right:12px;top:12px;z-index:50;padding:7px 12px;border-radius:99px;background:#e8f4fb;color:#123653;font-size:12px;box-shadow:0 2px 10px #1234}#cloudStatus[data-error="1"]{background:#fee;color:#822}';document.head.append(style);document.body.append(wrap);
  const form = wrap.querySelector('#cloudLogin');
  const reset = wrap.querySelector('#cloudReset');
  const msg = wrap.querySelector('#cloudMsg');
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault(); if(busy)return; busy=true;
    const button=form.querySelector('button'); button.disabled=true; reset.disabled=true;
    msg.textContent='Проверяю вход…';
    try {
      const {data,error}=await supabase.auth.signInWithPassword({email:wrap.querySelector('#cloudEmail').value.trim().toLowerCase(),password:wrap.querySelector('#cloudPassword').value});
      if(error)throw error;
      wrap.querySelector('#cloudPassword').value='';
      if(!data?.session)throw new Error('Сервер не подтвердил вход.');
      await hydrate(data.session.user);
    } catch(error) { msg.textContent=authMessage(error); }
    finally {busy=false;button.disabled=false;reset.disabled=false;}
  });
  reset.addEventListener('click', async()=>{
    if(busy)return;
    const emailField=wrap.querySelector('#cloudEmail');
    if(!emailField.reportValidity())return;
    busy=true;reset.disabled=true;form.querySelector('button').disabled=true;
    msg.textContent='Запрашиваю письмо для установки пароля…';
    try {
      // The recovery request and callback must share this browser's PKCE storage.
      markPasswordSetup();
      const {error}=await supabase.auth.resetPasswordForEmail(emailField.value.trim().toLowerCase(),{redirectTo:location.origin+location.pathname});
      if(error)throw error;
      msg.textContent='Если эта почта зарегистрирована, на неё отправлена ссылка для установки пароля. Открой новое письмо в этом же браузере. Это нужно один раз.';
    } catch(error){clearPasswordSetup();msg.textContent=authMessage(error);}
    finally{busy=false;form.querySelector('button').disabled=false;setTimeout(()=>{reset.disabled=false;},60000);}
  });
};
function showDataLoad(user,epoch,failed=false){
  document.getElementById('cloudGate')?.remove();
  document.getElementById('cloudLoadGate')?.remove();
  const wrap=document.createElement('div');wrap.id='cloudLoadGate';
  wrap.setAttribute('role','dialog');wrap.setAttribute('aria-modal','true');wrap.setAttribute('aria-labelledby','cloudLoadTitle');
  wrap.innerHTML='<div style="box-sizing:border-box;width:min(460px,100%);padding:24px;border-radius:22px;background:#eff8fd;color:#123653;box-shadow:0 20px 60px #0006"><h2 id="cloudLoadTitle" style="margin-top:0"></h2><p id="cloudLoadMessage" role="status" aria-live="polite" style="line-height:1.55"></p><button id="cloudLoadRetry" class="btn gold" type="button"></button></div>';
  Object.assign(wrap.style,{position:'fixed',inset:'0',zIndex:'9999',display:'grid',placeItems:'center',padding:'20px',background:'#071d31ef',overflowY:'auto'});
  wrap.querySelector('#cloudLoadTitle').textContent=failed?'Не удалось загрузить данные':'Загружаю данные кабинета…';
  wrap.querySelector('#cloudLoadMessage').textContent=failed?'Вход сохранён. Когда соединение восстановится, повтори загрузку. Пароль вводить заново не нужно.':'Вход выполнен. Ожидаю данные с сервера.';
  const button=wrap.querySelector('#cloudLoadRetry');
  button.textContent=failed?'Повторить загрузку':'Загружаю…';button.disabled=!failed;
  button.addEventListener('click',async()=>{
    if(button.disabled||!isCurrent(user.id,epoch))return;
    button.disabled=true;
    await hydrate(user);
  });
  if(!document.getElementById('cloudLoadStyle')){
    const style=document.createElement('style');style.id='cloudLoadStyle';
    style.textContent='#cloudStatus{position:fixed;right:12px;top:12px;z-index:50;padding:7px 12px;border-radius:99px;background:#e8f4fb;color:#123653;font-size:12px;box-shadow:0 2px 10px #1234}#cloudStatus[data-error="1"]{background:#fee;color:#822}';document.head.append(style);
  }
  document.body.append(wrap);
  if(failed)button.focus();
}
async function hydrate(user) {
  resetAccount(user);
  if(!user){gate();setStatus('Supabase: ожидается вход');return;}
  const id=user.id,epoch=accountEpoch;
  showDataLoad(user,epoch);
  setStatus('Загружаю данные кабинета…');
  try{
    const {data:row,error}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',id).maybeSingle();
    if(!isCurrent(id,epoch))return;
    if(error)throw error;
    let pending=localStorage.getItem(pendingKey(id));
    const meta=readJson(metaKey(id)),savedConflict=readJson(conflictKey(id));
    if(pending&&row?.snapshot&&stableSnapshot(JSON.parse(pending))===stableSnapshot(row.snapshot)){
      localStorage.removeItem(pendingKey(id));localStorage.removeItem(metaKey(id));localStorage.removeItem(conflictKey(id));pending=null;
    }
    const ownLocal=localStorage.getItem(cacheKey(id))||(id===cfg.legacyOwnerId?localStorage.getItem('moikabinet_legacy:'+id):null);
    const stalePending=!!pending&&(!meta||meta.baseVersion!==(row?.updated_at||null));
    const hasConflict=stalePending||(!pending&&!!savedConflict);
    const snapshot=pending?JSON.parse(pending):hasConflict&&ownLocal?JSON.parse(ownLocal):row?.snapshot||(ownLocal?JSON.parse(ownLocal):{});
    adoptVersion(pending?(meta?.baseVersion||null):(row?.updated_at||null));
    applySnapshot(id,snapshot);accountReady=true;
    document.getElementById('cloudGate')?.remove();
    document.getElementById('cloudLoadGate')?.remove();
    if(row?.snapshot||!ownLocal){
      syncEnabled=true;
      setStatus('Свои данные загружены.');startPolling();
      if(hasConflict)flagConflict(id,meta?.baseVersion||savedConflict?.baseVersion||null,row?.updated_at||null);
      else if(pending)window.CABINET_SYNC.save(snapshot);else if(readJson(archiveKey(id)))conflictPanel(true);
    }else{setStatus('Своя локальная копия сохранена. Выбери подключение синхронизации.');initialSyncChoice(user);}
  }catch(error){if(isCurrent(id,epoch)){resetAccount(user);showDataLoad(user,accountEpoch,true);setStatus('Облачная загрузка не удалась: '+error.message,true);}}
}
function startPolling(){
  clearInterval(poller);const id=currentUser.id,epoch=accountEpoch;
  poller=setInterval(async()=>{
    if(!isCurrent(id,epoch)||!syncEnabled||syncConflict||restoreBusy||timer||localStorage.getItem(pendingKey(id)))return;
    try{
      const {data:fresh,error}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',id).maybeSingle();
      if(!isCurrent(id,epoch)||localStorage.getItem(pendingKey(id)))return;
      if(error)throw error;
      if(fresh?.snapshot&&fresh.updated_at!==lastCloudUpdate){
        if(window.__cabinetHasOpenEditor?.()){flagConflict(id,lastCloudUpdate||null,fresh.updated_at);return;}
        applySnapshot(id,fresh.snapshot);adoptVersion(fresh.updated_at);setStatus('Получены изменения с другого устройства.');
      }
    }catch(error){if(isCurrent(id,epoch))setStatus('Проверка синхронизации не удалась: '+error.message,true);}
  },5000);
}
function initialSyncChoice(user){
  document.getElementById('cloudSetup')?.remove();
  const wrap=document.createElement('div');wrap.id='cloudSetup';
  wrap.innerHTML='<div class="cloud-card"><h2>Подключить синхронизацию?</h2><p>Найдена локальная копия только этого аккаунта. Её можно перенести в свою облачную копию.</p><div class="cloud-actions"><button id="cloudImport" class="btn gold" type="button">Перенести свои данные в облако</button><button id="cloudLocal" class="btn light" type="button">Пока оставить только на этом устройстве</button></div><p id="cloudSetupMsg" role="status"></p></div>';
  Object.assign(wrap.style,{position:'fixed',inset:'0',zIndex:'9998',display:'grid',placeItems:'center',padding:'20px',background:'#071d31eF'});
  const style=document.createElement('style');style.textContent='#cloudSetup .cloud-card{width:min(500px,100%);padding:24px;border-radius:22px;background:#eff8fd;color:#123653;box-shadow:0 20px 60px #0006}#cloudSetup h2{margin-top:0}#cloudSetup p{line-height:1.55}#cloudSetup .cloud-actions{display:grid;gap:10px}';document.head.append(style);document.body.append(wrap);
  wrap.querySelector('#cloudLocal').addEventListener('click',()=>{wrap.remove();setStatus('Данные остаются на этом устройстве. Синхронизация пока выключена.');});
  const epoch=accountEpoch;
  wrap.querySelector('#cloudImport').addEventListener('click',async e=>{if(!isCurrent(user.id,epoch)||!accountReady)return;const button=e.currentTarget;button.disabled=true;syncEnabled=true;await saveSnapshot(user.id,epoch,JSON.stringify(getData()));if(!isCurrent(user.id,epoch))return;button.disabled=false;if(localStorage.getItem(pendingKey(user.id))){wrap.querySelector('#cloudSetupMsg').textContent='Облако не подтвердило сохранение. Локальная копия сохранена.';return;}wrap.remove();startPolling();});
}
function saveSnapshot(id,epoch,serialized,verify=false,context=normalContext()){
  const task=writeQueue.then(()=>writeSnapshot(id,epoch,serialized,verify,context));
  writeQueue=task.catch(()=>{});return task;
}
async function writeSnapshot(id,epoch,serialized,verify=false,context=normalContext()){
  if(!isCurrent(id,epoch)||!accountReady||!syncEnabled)return{confirmed:false,attempted:false,error:'Аккаунт сменился или облако не подключено.'};
  if(syncConflict){conflictPanel();return{confirmed:false,attempted:false,conflict:true,error:'Версия устарела. Правки сохранены локально.'};}
  // A newer edit may already be pending while this older write was queued.
  const baseVersion=expectedVersion(context);
  const updated_at=new Date(Math.max(Date.now(),baseVersion?Date.parse(baseVersion)+1:0)).toISOString();
  let attempted=false;
  try{
    if(!localStorage.getItem(pendingKey(id)))localStorage.setItem(pendingKey(id),serialized);
    attempted=true;
    if(!localStorage.getItem(metaKey(id)))localStorage.setItem(metaKey(id),JSON.stringify({...context,baseVersion}));
    const table=supabase.from('cabinet_state');
    const mutation=baseVersion===null?table.insert({user_id:id,snapshot:JSON.parse(serialized),updated_at}):table.update({snapshot:JSON.parse(serialized),updated_at}).eq('user_id',id).eq('updated_at',baseVersion);
    const {data:written,error}=await mutation.select('snapshot,updated_at');
    if(!isCurrent(id,epoch))return{confirmed:false,attempted,error:'Аккаунт сменился.'};
    if(error&&error.code!=='23505')throw error;
    let row=Array.isArray(written)?written[0]:written;
    if(!row){
      const {data:fresh,error:readError}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',id).maybeSingle();
      if(!isCurrent(id,epoch))return{confirmed:false,attempted,error:'Аккаунт сменился.'};
      if(readError)throw readError;
      if(fresh?.snapshot&&stableSnapshot(fresh.snapshot)===stableSnapshot(JSON.parse(serialized)))row=fresh;
      else{flagConflict(id,baseVersion,fresh?.updated_at||null);return{confirmed:false,attempted,conflict:true,error:'Данные изменились на другом устройстве. Ваши правки сохранены локально.'};}
    }
    if(verify){
      const {data:fresh,error:readError}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',id).maybeSingle();
      if(!isCurrent(id,epoch))return{confirmed:false,attempted,error:'Аккаунт сменился.'};
      if(readError)throw readError;
      if(stableSnapshot(fresh?.snapshot)!==stableSnapshot(JSON.parse(serialized))){flagConflict(id,baseVersion,fresh?.updated_at||null);return{confirmed:false,attempted,conflict:true,error:'После записи данные изменились. Файл сохранён локально.'};}
      row=fresh;
    }
    branchVersions.set(context.branch,row.updated_at);lastCloudUpdate=row.updated_at;
    if(localStorage.getItem(pendingKey(id))===serialized){localStorage.removeItem(pendingKey(id));localStorage.removeItem(metaKey(id));localStorage.removeItem(conflictKey(id));}
    else{const next=readJson(metaKey(id));if(next?.branch===context.branch&&next.baseVersion===baseVersion)localStorage.setItem(metaKey(id),JSON.stringify({...next,baseVersion:row.updated_at}));}
    setStatus('Синхронизировано · '+new Date().toLocaleTimeString('ru-RU'));
    return{confirmed:true,attempted};
  }catch(error){if(isCurrent(id,epoch))setStatus('Облачное сохранение не удалось: '+error.message,true);return{confirmed:false,attempted,error:error.message};}
}
window.CABINET_SYNC={
  canWrite(){return !!currentUser&&accountReady&&!restoreBusy;},
  restoreContext(){return currentUser&&accountReady&&!restoreBusy?freshContext():null;},
  captureWriteContext(){return currentUser&&accountReady?freshContext():null;},
  beginEdit(){if(currentUser&&accountReady)editContext=normalContext();},
  endEdit(){editContext=null;},
  hasConflict(){return syncConflict;},
  draftText,loadLatest,
  matchesContext(context){return !!context&&isCurrent(context.id,context.epoch)&&accountReady;},
  async restoreSnapshot(snapshot,context){
    if(!context||!isCurrent(context.id,context.epoch)||!accountReady||!syncEnabled||restoreBusy||syncConflict)return{confirmed:false,attempted:false,error:'Сначала загрузи свежую версию своего кабинета.'};
    const serialized=JSON.stringify(snapshot),id=context.id,epoch=context.epoch;
    restoreBusy=true;clearTimeout(timer);timer=0;clearInterval(poller);poller=0;
    try{markPendingVersion(serialized,context);return await saveSnapshot(id,epoch,serialized,true,context);}
    catch(error){return{confirmed:false,attempted:false,error:error.message};}
    finally{if(isCurrent(id,epoch)){restoreBusy=false;startPolling();}}
  },
  markPending:markPendingVersion,
  save(snapshot,context=normalContext()){
    if(!currentUser||!accountReady||!syncEnabled||applyingRemote||restoreBusy)return;
    const id=currentUser.id,epoch=accountEpoch,serialized=JSON.stringify(snapshot);
    markPendingVersion(serialized,context);
    if(syncConflict){conflictPanel();return;}
    clearTimeout(timer);setStatus('Сохраняю в облако…');
    timer=setTimeout(()=>{timer=0;return saveSnapshot(id,epoch,serialized,false,context);},650);
  },
  async signOut(){resetAccount();clearPasswordSetup();gate();setStatus('Supabase: ожидается вход');const {error}=await supabase.auth.signOut();if(error)setStatus('Данные скрыты. Сервер не подтвердил выход: '+error.message,true);}
};

function authMessage(error){
  const message=error?.message||'';
  if(/Failed to fetch|fetch failed|NetworkError|network request/i.test(message))return 'Нет соединения с сервером входа. Пароль не проверен. Проверь интернет и попробуй позже.';
  if(/rate limit/i.test(message))return 'Слишком много запросов. Нужно дождаться восстановления лимита; повторные нажатия не помогут.';
  if(/Invalid login credentials/i.test(message))return 'Не подошла почта или пароль. Если пароль ещё не задан, нажми «Установить или восстановить пароль».';
  return 'Не удалось завершить действие: '+message;
}
function showPasswordSetup(){
  if(document.getElementById('passwordSetup'))return;
  document.getElementById('cloudGate')?.remove();
  const wrap=document.createElement('div');wrap.id='passwordSetup';
  Object.assign(wrap.style,{position:'fixed',inset:'0',zIndex:'10001',display:'grid',placeItems:'center',padding:'20px',background:'#071d31ef',overflowY:'auto'});
  wrap.innerHTML=`<div style="width:min(460px,100%);box-sizing:border-box;padding:24px;border-radius:22px;background:#eff8fd;color:#123653"><h2>Установить пароль кабинета</h2><p>Почта подтверждена. Задай пароль, чтобы дальше входить без писем.</p><form id="passwordSetupForm" style="display:grid;gap:12px"><label for="newCabinetPassword">Новый пароль — от 12 символов</label><input id="newCabinetPassword" type="password" autocomplete="new-password" minlength="12" required><label for="confirmCabinetPassword">Повтори пароль</label><input id="confirmCabinetPassword" type="password" autocomplete="new-password" minlength="12" required><button class="btn gold" type="submit">Сохранить пароль и открыть кабинет</button></form><p id="passwordSetupMsg" role="status"></p></div>`;
  document.body.append(wrap);
  wrap.querySelector('form').addEventListener('submit',async e=>{
    e.preventDefault();const button=wrap.querySelector('button');if(button.disabled)return;
    const first=wrap.querySelector('#newCabinetPassword'),second=wrap.querySelector('#confirmCabinetPassword'),msg=wrap.querySelector('#passwordSetupMsg');
    if(first.value!==second.value){msg.textContent='Пароли не совпадают.';return;}
    if(first.value.length<12){msg.textContent='Введи не менее 12 символов.';return;}
    button.disabled=true;msg.textContent='Сохраняю пароль…';
    try{
      const {data,error}=await supabase.auth.updateUser({password:first.value});if(error)throw error;
      first.value='';second.value='';clearPasswordSetup();wrap.remove();
      await hydrate(data.user);
    }catch(error){msg.textContent=authMessage(error);button.disabled=false;}
  });
}

let authReady = false;
supabase.auth.onAuthStateChange((event,session)=>{
  const version=++authEventVersion;
  if(event==='PASSWORD_RECOVERY')markPasswordSetup();
  if(!authReady)return;
  // Clear private state immediately, including on a sign-out from another tab.
  if(!session?.user||session.user.id!==currentUser?.id)resetAccount(session?.user||null);
  if((event==='TOKEN_REFRESHED'||event==='SIGNED_IN')&&accountReady&&session?.user?.id===currentUser?.id)return;
  setTimeout(()=>{if(version!==authEventVersion)return;if(session?.user&&wantsPasswordSetup())showPasswordSetup();else hydrate(session?.user||null);},0);
});
// Parse the callback immediately; auth events below update the page once Supabase
// has exchanged the one-time link for a session.
const callbackParams = new URLSearchParams(location.hash.slice(1));
const queryParams = new URLSearchParams(location.search);
const authTrace = {time:new Date().toISOString(),codePresent:queryParams.has('code'),serverError:queryParams.get('error_code')||callbackParams.get('error_code')||null,stage:'callback-read'};
try {
  const ref = new URL(cfg.url).hostname.split('.')[0];
  authTrace.browserProofPresent = !!localStorage.getItem('sb-'+ref+'-auth-token-code-verifier');
} catch { authTrace.browserProofPresent = null; }
function saveAuthTrace(stage){
  authTrace.stage=stage;
  try{localStorage.setItem('cabinet_auth_diagnostic',JSON.stringify(authTrace));}catch{}
}
saveAuthTrace('callback-read');
const callbackError = callbackParams.get('error_description') || callbackParams.get('error') || queryParams.get('error_description') || queryParams.get('error');
let session = null, sessionError = null;
try {
  const code = queryParams.get('code');
  if (code) {
    saveAuthTrace('code-exchange-started');
    setStatus('Подтверждаю вход по ссылке…');
    const result = await supabase.auth.exchangeCodeForSession(code);
    session = result.data?.session; sessionError = result.error;
    saveAuthTrace(session?'code-exchange-succeeded':'code-exchange-failed');
    if (session) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('code');
      history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search);
    }
  } else {
    const result = await supabase.auth.getSession();
    session = result.data?.session; sessionError = result.error;
  }
} catch (error) { sessionError = error; saveAuthTrace('callback-exception'); }
authReady = true;
if(session?.user&&wantsPasswordSetup())showPasswordSetup();
else await hydrate(session?.user||null);
if (!session?.user && (callbackError || sessionError)) {
  const detail = callbackError || sessionError.message || 'Не удалось связаться с сервером входа.';
  const message = /verifier|flow_state/i.test(detail)
    ? 'Не найдено подтверждение запроса в этом браузере. Запроси новую ссылку здесь и открой её в этом же браузере. Не запрашивай несколько ссылок подряд.'
    : 'Вход по ссылке не завершён: ' + detail;
  setStatus(message, true);
  const messageNode = document.getElementById('cloudMsg');
  if (messageNode) messageNode.textContent = message;
}
if(!session?.user){
  const messageNode=document.getElementById('cloudMsg');
  if(messageNode){
    const diagnostic=document.createElement('small');
    diagnostic.style.display='block';
    diagnostic.textContent='Проверка входа: '+(authTrace.serverError?'сервер отклонил ссылку ('+authTrace.serverError+')':authTrace.codePresent?'код получен; '+(authTrace.browserProofPresent?'подтверждение браузера есть':'подтверждение браузера отсутствует'):'код подтверждения в адресе отсутствует')+'. Этап: '+authTrace.stage+'. Версия: auth-check-1.';
    messageNode.after(diagnostic);
  }
}
