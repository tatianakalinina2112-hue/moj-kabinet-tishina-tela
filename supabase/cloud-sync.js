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
async function authFetch(input, options = {}) {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, {once:true});
  const timeout = setTimeout(() => controller.abort(), 15000);
  try { return await fetch(input, {...options, signal:controller.signal}); }
  catch (error) {
    if (controller.signal.aborted) throw new Error('Нет ответа сервера за 15 секунд. Статус отправки письма неизвестен. Проверь почту; не отправляй запрос повторно сразу.');
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
const supabase = createClient(cfg.url, cfg.publishableKey, { global: {fetch: authFetch}, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } });
let currentUser = null, timer = 0, poller = 0, applyingRemote = false, syncEnabled = false, lastCloudUpdate = '';
const getData = () => window.__cabinetGetData?.();
const setData = value => window.__cabinetSetData?.(value);
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
      sessionStorage.setItem('cabinet_password_setup','pending');
      const {error}=await supabase.auth.resetPasswordForEmail(emailField.value.trim().toLowerCase(),{redirectTo:location.origin+location.pathname});
      if(error)throw error;
      msg.textContent='Если эта почта зарегистрирована, на неё отправлена ссылка для установки пароля. Открой новое письмо в этом же браузере. Это нужно один раз.';
    } catch(error){sessionStorage.removeItem('cabinet_password_setup');msg.textContent=authMessage(error);}
    finally{busy=false;form.querySelector('button').disabled=false;setTimeout(()=>{reset.disabled=false;},60000);}
  });
};
async function hydrate(user) {
  currentUser=user; syncEnabled=false; clearInterval(poller); if(!user){gate();setStatus('Supabase: ожидается вход');return;}
  document.getElementById('cloudGate')?.remove(); setStatus('Загружаю данные кабинета…');
  const {data:row,error}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',user.id).maybeSingle();
  if(error){setStatus('Облачная загрузка не удалась: '+error.message,true);return;}
  if(row?.snapshot){syncEnabled=true;lastCloudUpdate=row.updated_at;applyingRemote=true;try{setData(row.snapshot);localStorage.setItem('moikabinet_v1',JSON.stringify(row.snapshot));}finally{applyingRemote=false;}setStatus('Синхронизировано · '+new Date(row.updated_at).toLocaleString('ru-RU'));startPolling();}
  else {setStatus('Облачной копии пока нет. Данные с этого устройства не отправлены.');initialSyncChoice(user);}
}
function startPolling(){clearInterval(poller);poller=setInterval(async()=>{if(!currentUser||!syncEnabled||timer)return;const {data:fresh,error:pollError}=await supabase.from('cabinet_state').select('snapshot,updated_at').eq('user_id',currentUser.id).maybeSingle();if(pollError){setStatus('Проверка синхронизации не удалась: '+pollError.message,true);return;}if(fresh?.snapshot&&fresh.updated_at>lastCloudUpdate){lastCloudUpdate=fresh.updated_at;applyingRemote=true;try{setData(fresh.snapshot);localStorage.setItem('moikabinet_v1',JSON.stringify(fresh.snapshot));setStatus('Получены изменения с другого устройства · '+new Date().toLocaleTimeString('ru-RU'));}finally{applyingRemote=false;}}},5000);}
function initialSyncChoice(user){
  document.getElementById('cloudSetup')?.remove();
  const wrap=document.createElement('div');wrap.id='cloudSetup';
  wrap.innerHTML='<div class="cloud-card"><h2>Подключить синхронизацию?</h2><p>В облаке пока нет копии. В кабинете на этом устройстве сейчас есть данные. Выбери, переносить ли их в защищённое хранилище Supabase. Ничего не отправится, пока ты не нажмёшь кнопку переноса.</p><div class="cloud-actions"><button id="cloudImport" class="btn gold" type="button">Перенести данные в облако</button><button id="cloudLocal" class="btn light" type="button">Пока оставить только на этом устройстве</button></div><p id="cloudSetupMsg" role="status"></p></div>';
  Object.assign(wrap.style,{position:'fixed',inset:'0',zIndex:'9998',display:'grid',placeItems:'center',padding:'20px',background:'#071d31eF'});
  const style=document.createElement('style');style.textContent='#cloudSetup .cloud-card{width:min(500px,100%);padding:24px;border-radius:22px;background:#eff8fd;color:#123653;box-shadow:0 20px 60px #0006}#cloudSetup h2{margin-top:0}#cloudSetup p{line-height:1.55}#cloudSetup .cloud-actions{display:grid;gap:10px}';document.head.append(style);document.body.append(wrap);
  wrap.querySelector('#cloudLocal').addEventListener('click',()=>{wrap.remove();setStatus('Данные остаются на этом устройстве. Синхронизация пока выключена.');});
  wrap.querySelector('#cloudImport').addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;wrap.querySelector('#cloudSetupMsg').textContent='Переношу данные…';const updated_at=new Date().toISOString();const {error}=await supabase.from('cabinet_state').upsert({user_id:user.id,snapshot:getData(),updated_at},{onConflict:'user_id'});button.disabled=false;if(error){wrap.querySelector('#cloudSetupMsg').textContent='Не удалось перенести данные: '+error.message;return;}syncEnabled=true;lastCloudUpdate=updated_at;wrap.remove();setStatus('Первая облачная копия создана.');startPolling();});
}
window.CABINET_SYNC={save(snapshot){if(!currentUser||!syncEnabled||applyingRemote)return;clearTimeout(timer);setStatus('Сохраняю в облако…');timer=setTimeout(async()=>{const updated_at=new Date().toISOString();const {error}=await supabase.from('cabinet_state').upsert({user_id:currentUser.id,snapshot,updated_at},{onConflict:'user_id'});if(!error)lastCloudUpdate=updated_at;setStatus(error?'Облачное сохранение не удалось: '+error.message:'Синхронизировано · '+new Date().toLocaleTimeString('ru-RU'),!!error);},650);},async signOut(){syncEnabled=false;await supabase.auth.signOut();}};

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
      first.value='';second.value='';sessionStorage.removeItem('cabinet_password_setup');wrap.remove();
      await hydrate(data.user);
    }catch(error){msg.textContent=authMessage(error);button.disabled=false;}
  });
}

let authReady = false;
supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY')sessionStorage.setItem('cabinet_password_setup','pending');if(authReady)setTimeout(()=>{if(session?.user&&sessionStorage.getItem('cabinet_password_setup')==='pending')showPasswordSetup();else hydrate(session?.user||null);},0);});
// Parse the callback immediately; auth events below update the page once Supabase
// has exchanged the one-time link for a session.
const callbackParams = new URLSearchParams(location.hash.slice(1));
const queryParams = new URLSearchParams(location.search);
const callbackError = callbackParams.get('error_description') || callbackParams.get('error') || queryParams.get('error_description') || queryParams.get('error');
let session = null, sessionError = null;
try {
  const code = queryParams.get('code');
  if (code) {
    setStatus('Подтверждаю вход по ссылке…');
    const result = await supabase.auth.exchangeCodeForSession(code);
    session = result.data?.session; sessionError = result.error;
    if (session) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('code');
      history.replaceState(history.state, '', cleanUrl.pathname + cleanUrl.search);
    }
  } else {
    const result = await supabase.auth.getSession();
    session = result.data?.session; sessionError = result.error;
  }
} catch (error) { sessionError = error; }
authReady = true;
if(session?.user&&sessionStorage.getItem('cabinet_password_setup')==='pending')showPasswordSetup();
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
