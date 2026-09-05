import { registerSW } from 'virtual:pwa-register';

// Installed PWAs (iPhone/iPad home screen) keep running the old JS bundle
// until a new service worker activates. We install updates automatically so
// the home-screen icon stays the same app — no re-adding after each ship.
export function registerHeftSW(){
  if(!('serviceWorker' in navigator))return;
  if(new URLSearchParams(location.search).has('sandbox'))return;

  let pillShown=false;
  let applying=false;
  let registration=null;
  let updateSW=null;

  function userIsBusy(){
    const a=document.activeElement;
    return !!document.querySelector('.modal-scrim')||(a&&/INPUT|TEXTAREA/.test(a.tagName));
  }

  function applyUpdate(){
    if(applying)return;
    applying=true;
    try{
      if(updateSW)updateSW(true);
      else location.reload();
    }catch(_){
      location.reload();
    }
  }

  function showUpdatePill(){
    if(pillShown||document.querySelector('.updatepill'))return;
    if(!userIsBusy()){applyUpdate();return;}
    pillShown=true;
    const p=document.createElement('div');
    p.className='updatepill';p.setAttribute('role','status');
    const dot=document.createElement('span');dot.className='updatepill__dot';
    const msg=document.createElement('span');msg.textContent='Update ready';
    const btn=document.createElement('button');btn.type='button';btn.className='updatepill__btn';btn.textContent='Refresh';
    btn.addEventListener('click',function(){applyUpdate();});
    p.appendChild(dot);p.appendChild(msg);p.appendChild(btn);
    document.body.appendChild(p);
  }

  function checkForUpdate(){
    try{
      if(registration)registration.update();
      else if(updateSW)updateSW();
    }catch(_){}
  }

  function recheck(){
    checkForUpdate();
    if(document.querySelector('.updatepill')&&!userIsBusy())applyUpdate();
  }

  updateSW=registerSW({
    immediate:true,
    onNeedRefresh(){showUpdatePill();},
    onRegisteredSW(_swUrl,reg){
      registration=reg||null;
      if(!registration)return;
      // Home-screen iOS apps can sit suspended for days with no navigation.
      // Ask the browser to fetch a fresh SW on a timer while the app is open.
      setInterval(checkForUpdate,15*60*1000);
    },
  });

  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible')recheck();
  });
  window.addEventListener('focus',recheck);
  window.addEventListener('pageshow',recheck); // iOS app-switcher resume
  window.addEventListener('online',recheck);
}
