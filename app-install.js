// Only the public app shell is involved. Never cache auth callbacks or cloud data.
if ('serviceWorker' in navigator && !location.search && !location.hash) {
  navigator.serviceWorker.register('/app-worker.js').catch(() => {});
}
let installRequest;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installRequest = event;
  if (matchMedia('(display-mode: standalone)').matches) return;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Установить «Мой кабинет»';
  Object.assign(button.style,{position:'fixed',bottom:'96px',right:'16px',zIndex:'10002',padding:'12px 18px',border:'1px solid #b9ddf3',borderRadius:'14px',background:'#082e52',color:'#fff',font:'inherit',boxShadow:'0 4px 18px #082e5244'});
  button.addEventListener('click', async () => {
    if (!installRequest) return;
    button.disabled = true;
    try {
      await installRequest.prompt();
      const choice = await installRequest.userChoice;
      installRequest = null;
      if (choice.outcome === 'accepted') button.remove();
      else button.remove();
    } catch { button.disabled = false; }
  });
  document.body.append(button);
  window.addEventListener('appinstalled', () => button.remove(), {once:true});
});
