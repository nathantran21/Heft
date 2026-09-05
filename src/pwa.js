import { registerSW } from 'virtual:pwa-register';

// Keeps every device on the latest shipped code, not just the latest data.
// Supabase already syncs tasks/habits in real time (pull on focus, on visibility,
// and a 5s poll while open) — this closes the other half: an installed PWA that
// was merely suspended in the background (not fully quit) can keep running an
// old JS bundle in memory even after a new version is live, since no navigation
// happens on resume. We actively re-check for a new service worker whenever the
// app returns to foreground, and surface a small "Update ready" pill (or a quiet
// auto-refresh if nothing is mid-edit) so devices stop drifting apart visually.
export function registerHeftSW(){
  if(!('serviceWorker' in navigator))return;
  if(new URLSearchParams(location.search).has('sandbox'))return;

  let pillShown=false;
  let updateSW=null;

  function userIsBusy(){
    const a=document.activeElement;
    return !!document.querySelector('.modal-scrim')||(a&&/INPUT|TEXTAREA/.test(a.tagName));
  }

  function showUpdatePill(){
    if(pillShown||document.querySelector('.updatepill'))return;
    pillShown=true;
    const p=document.createElement('div');
    p.className='updatepill';p.setAttribute('role','status');
    const dot=document.createElement('span');dot.className='updatepill__dot';
    const msg=document.createElement('span');msg.textContent='Update ready';
    const btn=document.createElement('button');btn.type='button';btn.className='updatepill__btn';btn.textContent='Refresh';
    btn.addEventListener('click',function(){if(updateSW)updateSW(true);else location.reload();});
    p.appendChild(dot);p.appendChild(msg);p.appendChild(btn);
    document.body.appendChild(p);
  }

  updateSW=registerSW({
    immediate:true,
    onNeedRefresh(){showUpdatePill();},
  });

  function recheck(){
    if(updateSW)updateSW();
    if(document.querySelector('.updatepill')&&!userIsBusy()){
      if(updateSW)updateSW(true);else location.reload();
    }
  }
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')recheck();});
  window.addEventListener('focus',recheck);
}
