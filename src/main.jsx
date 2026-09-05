import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { registerHeftSW } from './pwa';
import './index.css';

// ===== SUPABASE =====
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ezmqnbfpnulsgcemmiia.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_-Jge59fyEZPiDTcjVWLygw_mW0y9WbE';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== SANDBOX MODE =====
// ?sandbox=1 → isolated test environment: separate localStorage key, no auth,
// no Supabase reads/writes. Real user data is never touched.
const SANDBOX=new URLSearchParams(location.search).has('sandbox');
const LS_KEY=SANDBOX?'heft.sandbox.v1':'heft.v1';
const LS_ONBOARD_KEY=SANDBOX?'heft.sandbox.onboarded':'heft.onboarded';
// ── Usage log ────────────────────────────────────────────────────────────
// Append-only ring buffer in its own localStorage key. Deliberately NOT part of
// the synced blob and never written to Supabase — it is a local baseline only.
const EV_KEY=SANDBOX?'heft.sandbox.events.v1':'heft.events.v1';
const EV_SNAP_KEY=SANDBOX?'heft.sandbox.events.lastSnap':'heft.events.lastSnap';
const EV_CAP=5000;
function readEvents(){try{const a=JSON.parse(localStorage.getItem(EV_KEY)||'[]');return Array.isArray(a)?a:[];}catch(_){return[];}}
function logEvent(e,meta){
  try{
    const arr=readEvents();
    arr.push({t:Date.now(),e:e,meta:meta||{}});
    if(arr.length>EV_CAP)arr.splice(0,arr.length-EV_CAP); // drop oldest
    localStorage.setItem(EV_KEY,JSON.stringify(arr));
  }catch(_){}
}
// column_scrolled is noisy — one per column per session is enough to see the shape.
const EV_SCROLLED=new Set();
function logColumnScrolled(stage){
  if(EV_SCROLLED.has(stage))return;
  EV_SCROLLED.add(stage);
  logEvent('column_scrolled',{stage:stage});
}
let CELEBRATE='full'; // 'full' | 'subtle' | 'off' — set from App settings

// ===== CONSTANTS =====
const STAGES=['todo','doing','done'];
// Depth is capped at three levels: Task > Subtask > Step. Steps hold no weight,
// tag, date, stage or notes, and there is deliberately NO affordance or code path
// that would create a child of a Step.
const MAX_SUBS=10;
const MAX_STEPS=6;
function stepsOf(s){return (s&&Array.isArray(s.steps))?s.steps:[];}
// Completing a subtask sinks it to the bottom of the list so remaining work
// stays on top. Unchecking lifts it back above the done pile.
function toggleSubAndSink(subs, subId){
  const list=(subs||[]).slice();
  const i=list.findIndex(s=>s.id===subId);
  if(i<0)return list;
  const next={...list[i],done:!list[i].done};
  list.splice(i,1);
  if(next.done){
    list.push(next);
  }else{
    const firstDone=list.findIndex(s=>s.done);
    list.splice(firstDone<0?list.length:firstDone,0,next);
  }
  return list;
}
function patchTaskSubToggle(task, subId){
  const subs=toggleSubAndSink(task.subtasks, subId);
  let stage=task.stage;
  if(task.completed) stage=(subs.length>0&&subs.every(s=>s.done))?'done':'doing';
  return {...task, subtasks:subs, stage};
}
// ── Backlog ──────────────────────────────────────────────────────────────
// A task with date===null lives in the Backlog and belongs to no day.
// Legacy tasks always carry a date string, and undefined/'' still falls back to
// today exactly as before, so nothing that already exists can be reinterpreted.
function isBacklog(t){return !!t&&t.date===null;}
function taskDay(t){return isBacklog(t)?null:((t&&t.date)||todayKeyNow());}
function onDay(t,key){return !isBacklog(t)&&taskDay(t)===key;}
const WIP_DEFAULT={todo:5,doing:2};
function normWip(w){
  const src=w&&typeof w==='object'?w:{};
  const num=(v,d)=>{const n=Math.max(0,Math.min(99,parseInt(v,10)));return isNaN(n)?d:n;};
  return{todo:num(src.todo,WIP_DEFAULT.todo),doing:num(src.doing,WIP_DEFAULT.doing)};
}
const STAGE_LABELS={todo:'To Do',doing:'In Progress',done:'Done',backlog:'Backlog'};
const STAGE_ICONS={todo:'circle',doing:'halfcircle',done:'checkcircle',backlog:'package'};
const WEIGHTS=['light','medium','heavy','extra'];
const WEIGHT_LABELS={light:'Light',medium:'Medium',heavy:'Heavy',extra:'Extra'};
const WEIGHT_DESC={light:'Quick, low effort',medium:'Moderate time & focus',heavy:'High time, demanding',extra:"Bonus — done when there's bandwidth"};
const WEIGHT_RANK={light:0,medium:1,heavy:2,extra:3};
const SORTS=[{id:'created',label:'Date created'},{id:'alpha',label:'Alphabetical'},{id:'weight',label:'Weight'}];
const FULL_MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const FULL_WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FONT_SETS={
  Minimal:{ui:"'Inter',-apple-system,system-ui,sans-serif",display:"'Inter',-apple-system,system-ui,sans-serif"},
  Grotesk:{ui:"'Space Grotesk',system-ui,sans-serif",display:"'Space Grotesk',system-ui,sans-serif"},
  Serif:{ui:"'Fraunces',Georgia,serif",display:"'Fraunces',Georgia,serif"},
  Mono:{ui:"'Courier Prime','Courier New',monospace",display:"'Courier Prime','Courier New',monospace"}
};
const FONT_KEYS=['Minimal','Grotesk','Serif','Mono'];
const ACCENTS={Clay:{light:['oklch(0.55 0.12 42)','#fbf4ea'],dark:['oklch(0.70 0.11 48)','#1e1810'],swatch:'oklch(0.58 0.13 42)'},Sage:{light:['oklch(0.50 0.07 145)','#f1f7f0'],dark:['oklch(0.72 0.08 145)','#0f150e'],swatch:'oklch(0.56 0.09 145)'},Ochre:{light:['oklch(0.58 0.105 84)','#2a2113'],dark:['oklch(0.76 0.105 84)','#241a08'],swatch:'oklch(0.68 0.115 84)'},Ink:{light:['oklch(0.35 0.02 60)','#f2ece0'],dark:['oklch(0.80 0.015 75)','#221c14'],swatch:'oklch(0.40 0.02 60)'}};
const ACCENT_KEYS=['Clay','Sage','Ochre','Ink'];
const HABIT_ICONS=['book','dumbbell','droplet','heart','pen','note','sun','moon','cal','checkcircle'];
const HABIT_CADENCES=[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']];
function habitCadence(h){return h&&(h.cadence==='weekly'||h.cadence==='monthly')?h.cadence:'daily';}
let _seq=100; function uid(){return 'i'+Date.now().toString(36)+(++_seq).toString(36)+Math.random().toString(36).slice(2,6);}

// ===== CONFETTI =====
function fireConfetti(x,y,intensity=1){
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(CELEBRATE==='off')return;
  const isDark=document.documentElement.getAttribute('data-dark')==='true';
  const colors=isDark?['#9DAE7B','#DCB262','#D08056','#B89A96','#B99C82']:['#8B9E6B','#D3A24A','#C4693F','#A98A86','#7A6A57'];
  const N=CELEBRATE==='subtle'?0:Math.round(16*intensity);
  for(let i=0;i<N;i++){
    const p=document.createElement('div');
    p.className='confetti-piece';
    const size=5+Math.random()*5;
    p.style.width=size+'px';p.style.height=(size*0.55)+'px';
    p.style.left=x+'px';p.style.top=y+'px';
    p.style.background=colors[i%colors.length];
    const angle=(Math.PI*2*i)/N+(Math.random()-0.5)*0.5;
    const dist=(34+Math.random()*46)*Math.sqrt(intensity);
    const dx=Math.cos(angle)*dist;
    const dy=Math.sin(angle)*dist-(26+Math.random()*22)*intensity;
    p.style.setProperty('--dx',dx.toFixed(1)+'px');
    p.style.setProperty('--dy',dy.toFixed(1)+'px');
    p.style.setProperty('--rot',(Math.random()*640-320).toFixed(0)+'deg');
    document.body.appendChild(p);
    p.addEventListener('animationend',()=>p.remove());
  }
  if(CELEBRATE==='full'&&navigator.vibrate)navigator.vibrate(intensity>1?[10,40,18]:10);
}

// Full-day celebration: center burst, no full-screen wash.
// Fired once when the last task of the focused day is completed.
function fireDayComplete(){
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  if(CELEBRATE==='off')return;
  if(CELEBRATE==='subtle'){fireConfetti(window.innerWidth/2,window.innerHeight*0.38,1);return;}
  fireConfetti(window.innerWidth/2,window.innerHeight*0.38,2.4);
  // letterpress moment: a rubber stamp thunks down over the board
  if(!document.querySelector('.stampveil')){
    const v=document.createElement('div');v.className='stampveil';
    const s=document.createElement('div');s.className='stampveil__stamp';s.textContent='Day complete';
    v.appendChild(s);document.body.appendChild(v);
    setTimeout(()=>v.classList.add('out'),1500);
    setTimeout(()=>v.remove(),2050);
  }
}

// ── Motion & Craft helpers (v0.23.0) ────────────────────────────────────────
// True exit for scrim modals: mark the topmost scrim as closing, let the CSS
// exit keyframes play, then run the real close. Falls back to an instant close
// under reduced motion or if no scrim is mounted.
function closeModalAnimated(cb){
  try{
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches){cb();return;}
    const scrims=document.querySelectorAll('.modal-scrim');
    const scrim=scrims.length?scrims[scrims.length-1]:null;
    if(!scrim){cb();return;}
    if(scrim.getAttribute('data-closing')==='true')return;
    scrim.setAttribute('data-closing','true');
    setTimeout(cb,200);
  }catch(_){cb();}
}
// FLIP glide for the board. Cards carry data-flip-id; after any commit that
// moves a card (checkbox cycle, drag drop, sort, carry-over, view morph) the
// card glides from its previous rect to its new one instead of teleporting.
// WAAPI keeps the CSS untouched; reduced-motion users just see the reposition.
function useBoardFlip(resetKey){
  const rects=useRef(new Map());
  const keyRef=useRef(resetKey);
  // Scrolling moves every card's viewport rect without a render. If we kept the
  // pre-scroll rects, the next render (sync poll, toast, tick) would read a huge
  // false delta and glide EVERY card by the scroll distance — a whole-board
  // flicker. Recapture rects (rAF-throttled) whenever anything scrolls/resizes.
  useEffect(()=>{
    let raf=0;
    function recapture(){
      if(raf)return;
      raf=requestAnimationFrame(()=>{
        raf=0;
        const next=new Map();
        document.querySelectorAll('.board [data-flip-id]').forEach(el=>{
          next.set(el.getAttribute('data-flip-id'),el.getBoundingClientRect());
        });
        rects.current=next;
      });
    }
    document.addEventListener('scroll',recapture,{capture:true,passive:true});
    window.addEventListener('resize',recapture);
    return()=>{
      document.removeEventListener('scroll',recapture,{capture:true});
      window.removeEventListener('resize',recapture);
      if(raf)cancelAnimationFrame(raf);
    };
  },[]);
  useLayoutEffect(()=>{
    if(keyRef.current!==resetKey){keyRef.current=resetKey;rects.current=new Map();}
    const reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    const els=document.querySelectorAll('.board [data-flip-id]');
    const next=new Map();
    els.forEach(el=>{
      const id=el.getAttribute('data-flip-id');
      const r=el.getBoundingClientRect();
      next.set(id,r);
      if(reduce||!el.animate)return;
      const old=rects.current.get(id);
      if(!old)return;
      const dx=old.left-r.left,dy=old.top-r.top;
      if(Math.abs(dx)<3&&Math.abs(dy)<3)return;
      if(document.body.classList.contains('heft-dragging'))return;
      el.style.animation='none'; // a moved card glides; it never re-runs its entrance
      try{
        el.animate(
          [{transform:'translate('+dx+'px,'+dy+'px) scale(1.012)',boxShadow:'0 12px 26px -14px rgba(60,44,28,.32)'},
           {transform:'translate(0,0) scale(1)',boxShadow:'0 1px 0 rgba(0,0,0,0)'}],
          {duration:Math.min(440,250+Math.hypot(dx,dy)*0.2),easing:'cubic-bezier(.22,1,.36,1)'}
        );
      }catch(_){}
    });
    rects.current=next;
  });
}

// ===== HELPERS =====
function dayKey(d){const p=(n)=>n<10?'0'+n:''+n;return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function todayDate(){const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate());}
function shiftDay(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
function weekDays(d){const s=new Date(d.getFullYear(),d.getMonth(),d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>new Date(s.getFullYear(),s.getMonth(),s.getDate()+i));}
function monthDays(d){const y=d.getFullYear(),m=d.getMonth();const last=new Date(y,m+1,0).getDate();return Array.from({length:last},(_,i)=>new Date(y,m,i+1));}
function periodKeys(cadence,d){
  if(cadence==='weekly')return weekDays(d).map(dayKey);
  if(cadence==='monthly')return monthDays(d).map(dayKey);
  return[dayKey(d)];
}
function periodDone(set,cadence,d){return periodKeys(cadence,d).some(k=>set.has(k));}
function periodIsFuture(cadence,d){
  const today=dayKey(todayDate());
  if(cadence==='weekly')return dayKey(weekDays(d)[0])>today;
  if(cadence==='monthly')return dayKey(new Date(d.getFullYear(),d.getMonth(),1))>today;
  return dayKey(d)>today;
}
function periodIsCurrent(cadence,d){
  const t=todayDate();
  if(cadence==='weekly')return dayKey(weekDays(d)[0])===dayKey(weekDays(t)[0]);
  if(cadence==='monthly')return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth();
  return dayKey(d)===dayKey(t);
}
function periodLabel(cadence,d){
  if(cadence==='weekly'){
    if(periodIsCurrent('weekly',d))return'This week';
    const start=weekDays(d)[0];
    return'Week of '+start.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }
  if(periodIsCurrent('monthly',d))return'This month';
  return d.toLocaleDateString(undefined,{month:'long',year:'numeric'});
}
function streakUnit(cadence,n){
  if(cadence==='weekly')return n===1?'week':'week streak';
  if(cadence==='monthly')return n===1?'month':'month streak';
  return n===1?'day':'day streak';
}
function streakStartCopy(cadence){
  if(cadence==='weekly')return'Start this week';
  if(cadence==='monthly')return'Start this month';
  return'Start today';
}
function HabitCadenceSeg({value,onChange}){
  return(
    <div className="seg seg--inline hmgr__cadence" role="group" aria-label="Repeat">
      {HABIT_CADENCES.map(([v,l])=>(
        <button type="button" key={v} className="seg__opt" data-on={(value||'daily')===v?'true':'false'} onClick={()=>onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
function fullDateLabel(d){const norm=new Date(d.getFullYear(),d.getMonth(),d.getDate());const today=todayDate();const diff=Math.round((norm-today)/86400000);return{text:FULL_WEEKDAYS[d.getDay()]+', '+FULL_MONTHS[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear(),isToday:diff===0};}
function carryLabel(d){return d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});} // e.g. "Sun, May 31"
function sortTasks(list,sort){const arr=list.slice();if(sort==='alpha')arr.sort((a,b)=>a.name.localeCompare(b.name));else if(sort==='weight')arr.sort((a,b)=>(WEIGHT_RANK[a.weight]-WEIGHT_RANK[b.weight])||((a.seq||0)-(b.seq||0)));else arr.sort((a,b)=>(a.seq||0)-(b.seq||0));return arr;}

// ===== ICONS =====
function Icon({name,size=16}){
  const s={width:size,height:size,display:'block'};
  const p={fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'};
  switch(name){
    case 'check':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M5 13l4 4L19 7"/></svg>;
    case 'dots':return <svg viewBox="0 0 24 24" style={s}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>;
    case 'chevDown':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M6 9l6 6 6-6"/></svg>;
    case 'plus':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 5v14M5 12h14"/></svg>;
    case 'promote':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M5 4h14"/><path {...p} d="M12 21V8"/><path {...p} d="M6.6 13.4L12 8l5.4 5.4"/></svg>;
    case 'link':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M10.1 13.9a4.5 4.5 0 0 0 6.4 0l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5"/><path {...p} d="M13.9 10.1a4.5 4.5 0 0 0-6.4 0l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/></svg>;
    case 'x':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'trash':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>;
    case 'sort':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 7h13M4 12h9M4 17h5"/><path {...p} d="M17 14l3 3 3-3M20 17V8"/></svg>;
    case 'filter':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 5h16l-6 7v6l-4 2v-8z"/></svg>;
    case 'chevron':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M9 6l6 6-6 6"/></svg>;
    case 'chevL':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M15 6l-6 6 6 6"/></svg>;
    case 'refresh':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5"/></svg>;
    case 'settings':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="3"/><path {...p} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    case 'circle':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="8"/></svg>;
    case 'halfcircle':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>;
    case 'checkcircle':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="8"/><path {...p} d="M8.5 12.2l2.4 2.4 4.6-5.2"/></svg>;
    case 'collapseL':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="M9 4v16"/><path {...p} d="M16.5 9.5L14 12l2.5 2.5"/></svg>;
    case 'expandR':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="M9 4v16"/><path {...p} d="M13.5 9.5L16 12l-2.5 2.5"/></svg>;
    case 'search':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="11" cy="11" r="7"/><path {...p} d="M20 20l-3.6-3.6"/></svg>;
    case 'edit':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M3 21l1.3-4.2L15 6.1l3 3L7.2 19.7 3 21z"/><path {...p} d="M13.2 7.9l3 3"/><path {...p} d="M15 6.1l1.9-1.9a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L18 9.1z"/><path {...p} d="M4.3 16.8l3 3"/></svg>;
    case 'grip':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M8 7h8M8 12h8M8 17h8"/></svg>;
    case 'subtasks':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 7h13M4 12h9M4 17h5"/></svg>;
    case 'book':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 6v14"/><path {...p} d="M12 6c-1.6-1.3-3.7-2-6-2v13c2.3 0 4.4.7 6 2"/><path {...p} d="M12 6c1.6-1.3 3.7-2 6-2v13c-2.3 0-4.4.7-6 2"/></svg>;
    case 'dumbbell':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></svg>;
    case 'droplet':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 3.5c3 4 6 6.8 6 10.2A6 6 0 016 13.7C6 10.3 9 7.5 12 3.5z"/></svg>;
    case 'heart':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 20s-7-4.4-9.2-8.8C1.4 8 3 5.3 6 5.3c2 0 3.2 1.2 6 3.9 2.8-2.7 4-3.9 6-3.9 3 0 4.6 2.7 3.2 5.9C19 15.6 12 20 12 20z"/></svg>;
    case 'pen':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5 4 20z"/><path {...p} d="M14 6.5L17.5 10"/></svg>;
    case 'note':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M5 4h14v16l-4-3H5z"/><path {...p} d="M9 9h6M9 13h4"/></svg>;
    case 'sun':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="4"/><path {...p} d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>;
    case 'moon':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z"/></svg>;
    case 'cal':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="5" width="18" height="16" rx="2"/><path {...p} d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case 'lock':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="5" y="11" width="14" height="9" rx="2.2"/><path {...p} d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>;
    case 'layout':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="4" width="18" height="16" rx="2"/><path {...p} d="M9 4v16M15 4v16"/></svg>;
    case 'bell':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M6 9a6 6 0 0 1 12 0c0 4.5 1.8 5.8 2 6H4c.2-.2 2-1.5 2-6z"/><path {...p} d="M10 19a2 2 0 0 0 4 0"/></svg>;
    case 'clock':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="8.2"/><path {...p} d="M12 7.5V12l3 2"/></svg>;
    case 'download':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 4v11M7.5 11.5L12 16l4.5-4.5"/><path {...p} d="M5 20h14"/></svg>;
    case 'archive':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3.5" y="4" width="17" height="4.5" rx="1.4"/><path {...p} d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5"/><path {...p} d="M10 12.5h4"/></svg>;
    case 'camera':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M3 8.5h3.2L8 6h8l1.8 2.5H21V19H3z"/><circle {...p} cx="12" cy="13" r="3.4"/></svg>;
    case 'auto':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 0 0 16.4z" fill="currentColor" stroke="none"/></svg>;
    case 'camera':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle {...p} cx="12" cy="13" r="4"/></svg>;
    case 'star':return <svg viewBox="0 0 24 24" style={s}><polygon {...p} points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
    case 'briefcase':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="2" y="7" width="20" height="14" rx="2"/><path {...p} d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>;
    case 'users':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle {...p} cx="9" cy="7" r="4"/><path {...p} d="M23 21v-2a4 4 0 0 0-3-3.87"/><path {...p} d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case 'mappin':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle {...p} cx="12" cy="10" r="3"/></svg>;
    case 'mail':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="2" y="4" width="20" height="16" rx="2"/><path {...p} d="M22 7l-10 7L2 7"/></svg>;
    case 'package':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path {...p} d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>;
    case 'globe':return <svg viewBox="0 0 24 24" style={s}><circle {...p} cx="12" cy="12" r="10"/><path {...p} d="M2 12h20"/><path {...p} d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
    case 'palette':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.01 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.49-9-10-9z"/></svg>;
    case 'music':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M9 18V5l12-2v13"/><circle {...p} cx="6" cy="18" r="3"/><circle {...p} cx="18" cy="16" r="3"/></svg>;
    case 'coffee':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>;
    case 'zap':return <svg viewBox="0 0 24 24" style={s}><polygon {...p} points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'heart':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;
    case 'filetext':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path {...p} d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>;
    case 'repeat':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>;
    case 'copy':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="8" y="8" width="12" height="12" rx="2"/><path {...p} d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>;
        case 'lightbulb':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M9 21h6M12 3a6 6 0 0 1 4.24 10.24c-.9.9-1.5 2.1-1.74 3.26H9.5c-.24-1.16-.84-2.36-1.74-3.26A6 6 0 0 1 12 3z"/><path {...p} d="M9 17h6"/></svg>;
    case 'dots':return <svg viewBox="0 0 24 24" style={s}><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>;
    case 'arrowright':return <svg viewBox="0 0 24 24" style={s}><path {...p} d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'carryover':return <svg viewBox="0 0 24 24" style={s}><rect {...p} x="3" y="4.5" width="18" height="16" rx="2"/><path {...p} d="M3 9h18M8 2.5v4M16 2.5v4"/><path {...p} d="M9 14h6M13 12l2 2-2 2"/></svg>;
    default:return null;
  }
}

function HeftMark({size=24}){
  return(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="14" width="4" height="7" rx="1.2" fill="var(--w-light)"/>
      <rect x="8" y="9" width="4" height="12" rx="1.2" fill="var(--w-heavy)"/>
      <rect x="14" y="11" width="4" height="10" rx="1.2" fill="var(--w-medium)"/>
      <rect x="20" y="13" width="2" height="8" rx="1" fill="var(--w-extra)"/>
    </svg>
  );
}

// ===== MINI CALENDAR =====
function MiniCalendar({focusDate,setFocusDate,taskDays}){
  const [view,setView]=useState(()=>({y:focusDate.getFullYear(),m:focusDate.getMonth()}));
  const selKey=dayKey(focusDate);
  useEffect(()=>setView({y:focusDate.getFullYear(),m:focusDate.getMonth()}),[selKey]);
  const todayKey=dayKey(todayDate());
  const startDow=new Date(view.y,view.m,1).getDay();
  const daysInMonth=new Date(view.y,view.m+1,0).getDate();
  const cells=[];for(let i=0;i<startDow;i++)cells.push(null);for(let d=1;d<=daysInMonth;d++)cells.push(d);
  const shiftMonth=(n)=>setView(v=>{const nm=v.m+n;return{y:v.y+Math.floor(nm/12),m:((nm%12)+12)%12};});
  return(
    <div className="minical">
      <div className="minical__head">
        <span className="minical__month">{FULL_MONTHS[view.m]} {view.y}</span>
        <div className="minical__nav">
          <button className="minical__arrow" aria-label="Previous month" onClick={()=>shiftMonth(-1)}><Icon name="chevL" size={13}/></button>
          <button className="minical__arrow" aria-label="Next month" onClick={()=>shiftMonth(1)}><Icon name="chevron" size={13}/></button>
        </div>
      </div>
      <div className="minical__grid">{WEEKDAYS.map((d,i)=><span key={i} className="minical__dowcell">{d[0]}</span>)}</div>
      <div className="minical__grid">
        {cells.map((d,i)=>{
          if(d===null)return<span key={'e'+i} className="minical__cell minical__cell--empty"/>;
          const key=dayKey(new Date(view.y,view.m,d));
          return<button key={key} className="minical__cell" data-sel={key===selKey?'true':'false'} data-today={key===todayKey?'true':'false'} onClick={()=>setFocusDate(new Date(view.y,view.m,d))}><span className="minical__num">{d}</span>{taskDays&&taskDays.has(key)&&<span className="minical__dot"/>}</button>;
        })}
      </div>
    </div>
  );
}

// ===== HABIT TRACKER =====
function HabitIcon({icon,size=14}){
  if(icon&&icon.indexOf('data:')===0)return<img src={icon} alt="" style={{width:size,height:size,objectFit:'cover',borderRadius:3}}/>;
  return<Icon name={icon} size={size}/>;
}
function HabitIconGrid({selected,onPick,onImport,customIcons}){
  return(
    <div className="habitnew__icons">
      {HABIT_ICONS.map(ic=><button key={ic} type="button" className="habitnew__ico" data-on={selected===ic?'true':'false'} aria-label={ic} onClick={()=>onPick(ic)}><Icon name={ic} size={14}/></button>)}
      {(customIcons||[]).map((src,i)=><button key={'c'+i} type="button" className="habitnew__ico habitnew__ico--img" data-on={selected===src?'true':'false'} onClick={()=>onPick(src)}><img src={src} alt=""/></button>)}
      <button type="button" className="habitnew__ico habitnew__ico--add" onClick={onImport}><Icon name="plus" size={14}/></button>
    </div>
  );
}
function HabitManager({habits,onAdd,onRemove,onEdit,onClose}){
  const [draft,setDraft]=useState('');
  const [draftIcon,setDraftIcon]=useState(HABIT_ICONS[0]);
  const [draftCadence,setDraftCadence]=useState('daily');
  const [customIcons,setCustomIcons]=useState([]);
  const [pickerFor,setPickerFor]=useState(null);
  const fileRef=useRef(null);
  const importTarget=useRef(null);
  function addNew(){const v=draft.trim();if(!v)return;onAdd(v,draftIcon,draftCadence);setDraft('');setDraftIcon(HABIT_ICONS[0]);setDraftCadence('daily');setPickerFor(null);}
  function openImport(target){importTarget.current=target;if(fileRef.current)fileRef.current.click();}
  function importIcon(e){const file=e.target.files&&e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=(ev)=>{const url=ev.target.result;setCustomIcons(arr=>arr.includes(url)?arr:[...arr,url]);if(importTarget.current==='new')setDraftIcon(url);else if(importTarget.current!=null)onEdit(importTarget.current,{icon:url});};reader.readAsDataURL(file);e.target.value='';}
  return(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal__panel" role="dialog" aria-modal="true" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="modal__bar"><span className="modal__title">Habits</span><button className="iconbtn" onClick={onClose}><Icon name="x" size={18}/></button></div>
        <div className="modal__body">
          <div className="hmgr__list">
            {habits.length===0?<p className="hmgr__empty">No habits yet — add one below.</p>:habits.map(h=>(
              <div className="hmgr__item" key={h.id}>
                <div className="hmgr__row">
                  <button type="button" className="hmgr__ico" data-on={pickerFor===h.id?'true':'false'} onClick={()=>setPickerFor(p=>p===h.id?null:h.id)}><HabitIcon icon={h.icon} size={16}/></button>
                  <input className="input hmgr__name" value={h.name} placeholder="Habit name" onChange={(e)=>onEdit(h.id,{name:e.target.value})}/>
                  <button type="button" className="hmgr__del" aria-label={'Delete habit: '+h.name} onClick={()=>onRemove(h.id)}><Icon name="trash" size={15}/></button>
                </div>
                <HabitCadenceSeg value={habitCadence(h)} onChange={(v)=>onEdit(h.id,{cadence:v})}/>
                {pickerFor===h.id&&<HabitIconGrid selected={h.icon} customIcons={customIcons} onPick={(ic)=>onEdit(h.id,{icon:ic})} onImport={()=>openImport(h.id)}/>}
              </div>
            ))}
          </div>
          <div className="hmgr__new">
            <span className="setsec__lbl">Add a habit</span>
            <div className="hmgr__row">
              <button type="button" className="hmgr__ico" data-on={pickerFor==='new'?'true':'false'} onClick={()=>setPickerFor(p=>p==='new'?null:'new')}><HabitIcon icon={draftIcon} size={16}/></button>
              <input className="input hmgr__name" value={draft} placeholder="New habit name…" onChange={(e)=>setDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')addNew();}}/>
              <button type="button" className="btn btn--primary" onClick={addNew} disabled={!draft.trim()}>Add</button>
            </div>
            <HabitCadenceSeg value={draftCadence} onChange={setDraftCadence}/>
            {pickerFor==='new'&&<HabitIconGrid selected={draftIcon} customIcons={customIcons} onPick={setDraftIcon} onImport={()=>openImport('new')}/>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={importIcon}/>
        </div>
        <div className="modal__foot"><span/><button className="btn btn--primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
// Archive of deleted tasks and habits, recoverable from Settings → Habit archive.
// Habit streak history stays in habitLog (keyed by id), so recovering a habit
// restores it with its full history; recovering a task returns it to its day.
function ArchiveRow({label,icon,onRecover,onDelete,confirming,setConfirming}){
  return(
    <div className="hmgr__item">
      <div className="hmgr__row">
        {icon&&<span className="hmgr__ico" style={{cursor:'default'}}><HabitIcon icon={icon} size={16}/></span>}
        <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</span>
        {confirming?(
          <div className="hmgr__delconfirm"><button type="button" className="btn btn--ghost btn--danger hmgr__delconfirm-yes" onClick={()=>{onDelete();setConfirming(false);}}>Delete</button><button type="button" className="btn btn--ghost hmgr__delconfirm-no" onClick={()=>setConfirming(false)}>Keep</button></div>
        ):(
          <React.Fragment>
            <button type="button" className="btn btn--ghost" style={{color:'var(--accent)',fontSize:12}} onClick={onRecover}><Icon name="archive" size={14}/>Recover</button>
            <button type="button" className="hmgr__del" title="Delete permanently" onClick={()=>setConfirming(true)}><Icon name="trash" size={15}/></button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
function ArchiveModal({taskArchive,habitArchive,onRecoverTask,onDeleteTask,onRecoverTasksForDay,onRecoverHabit,onDeleteHabit,onClose}){
  const [confirmKey,setConfirmKey]=useState(null); // 't:'+id or 'h:'+id
  const tasks=taskArchive||[];const habits=habitArchive||[];
  const empty=tasks.length===0&&habits.length===0;
  // Group archived tasks by the day they belong to (most recent first) so each
  // day can be restored in one tap.
  const taskGroups=(()=>{
    const m=new Map();
    tasks.forEach(t=>{const k=t.date||'';if(!m.has(k))m.set(k,[]);m.get(k).push(t);});
    return [...m.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([key,items])=>({key,items,label:key?fullDateLabel(new Date(key+'T00:00:00')).text:'No date'}));
  })();
  return(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal__panel" role="dialog" aria-modal="true" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="modal__bar"><span className="modal__title">Archive</span><button className="iconbtn" onClick={onClose}><Icon name="x" size={18}/></button></div>
        <div className="modal__body">
          {empty&&<p className="hmgr__empty">Nothing archived yet. Deleted tasks and habits land here and can be recovered.</p>}
          {tasks.length>0&&(
            <div className="setsec">
              <span className="setsec__lbl">Tasks</span>
              {taskGroups.map(g=>(
                <div className="archive__group" key={g.key||'(none)'}>
                  <div className="archive__dayhead">
                    <span className="archive__daylbl">{g.label}</span>
                    <button type="button" className="archive__restoreall" onClick={()=>onRecoverTasksForDay(g.key)}><Icon name="archive" size={13}/>Restore all tasks</button>
                  </div>
                  <div className="hmgr__list">
                    {g.items.map(t=>(
                      <ArchiveRow key={t.id} label={t.name||'Untitled task'} onRecover={()=>onRecoverTask(t.id)} onDelete={()=>onDeleteTask(t.id)} confirming={confirmKey==='t:'+t.id} setConfirming={(v)=>setConfirmKey(v?'t:'+t.id:null)}/>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {habits.length>0&&(
            <div className="setsec">
              <span className="setsec__lbl">Habits</span>
              <div className="hmgr__list">
                {habits.map(h=>(
                  <ArchiveRow key={h.id} label={h.name} icon={h.icon} onRecover={()=>onRecoverHabit(h.id)} onDelete={()=>onDeleteHabit(h.id)} confirming={confirmKey==='h:'+h.id} setConfirming={(v)=>setConfirmKey(v?'h:'+h.id:null)}/>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal__foot"><span/><button className="btn btn--primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
// Consecutive-period streak ending in the current period (or the previous one
// if this period is still unchecked). Daily = days; weekly/monthly = weeks/months.
function habitStreak(set,cadence='daily'){
  cadence=cadence==='weekly'||cadence==='monthly'?cadence:'daily';
  if(cadence==='daily'){
    let n=0;let d=todayDate();
    if(!set.has(dayKey(d)))d=shiftDay(d,-1);
    while(set.has(dayKey(d))){n++;d=shiftDay(d,-1);}
    return n;
  }
  if(cadence==='weekly'){
    let n=0;let d=todayDate();
    if(!periodDone(set,'weekly',d))d=shiftDay(d,-7);
    while(periodDone(set,'weekly',d)){n++;d=shiftDay(d,-7);}
    return n;
  }
  let n=0;let d=todayDate();
  if(!periodDone(set,'monthly',d))d=new Date(d.getFullYear(),d.getMonth()-1,1);
  while(periodDone(set,'monthly',d)){n++;d=new Date(d.getFullYear(),d.getMonth()-1,1);}
  return n;
}
function HabitTracker({habits,focusDate,habitLog,toggleHabit,onManageHabits}){
  const week=weekDays(focusDate);const todayKey=dayKey(todayDate());const selKey=dayKey(focusDate);
  return(
    <div>
      <div className="habits">
        {habits.length===0&&<button className="habits__empty" onClick={onManageHabits}><Icon name="plus" size={13}/>Add your first habit</button>}
        {habits.map(h=>{
          const cadence=habitCadence(h);
          const set=new Set(habitLog[h.id]||[]);const streak=habitStreak(set,cadence);
          return(
            <div className="habit" key={h.id}>
              <div className="habit__top">
                <span className="habit__name"><HabitIcon icon={h.icon} size={14}/>{h.name}</span>
                <span className="habit__streak" data-active={streak>0?'true':'false'}>{streak>0?(<React.Fragment><span className="habit__streaknum counttick" key={streak}>{streak}</span><span className="habit__streaklbl">{streakUnit(cadence,streak)}</span></React.Fragment>):(<span className="habit__streaklbl habit__streaklbl--start">{streakStartCopy(cadence)}</span>)}</span>
              </div>
              {cadence==='daily'?(
              <div className="habit__week">
                {week.map(d=>{const k=dayKey(d);const future=k>todayKey;return<button key={k} className="habit__day" aria-label={h.name+', '+d.toLocaleDateString(undefined,{weekday:'long'})+(set.has(k)?' — done':' — not done')} data-done={set.has(k)?'true':'false'} data-sel={k===selKey?'true':'false'} data-future={future?'true':'false'} disabled={future} onClick={(e)=>{const willComplete=!set.has(k);if(willComplete&&k===todayKey){const dot=e.currentTarget.querySelector('.habit__daydot');const r=(dot||e.currentTarget).getBoundingClientRect();fireConfetti(r.left+r.width/2,r.top+r.height/2);}toggleHabit(h.id,'daily',d);}}><span className="habit__daylbl">{WEEKDAYS[d.getDay()][0]}</span><span className="habit__daydot"><Icon name="check" size={9}/></span></button>;})}
              </div>
              ):(()=>{
                const done=periodDone(set,cadence,focusDate);
                const future=periodIsFuture(cadence,focusDate);
                const lbl=periodLabel(cadence,focusDate);
                return(
                  <div className="habit__period">
                    <button type="button" className="habit__periodbtn" aria-label={h.name+', '+lbl+(done?' — done':' — not done')} data-done={done?'true':'false'} data-future={future?'true':'false'} disabled={future} onClick={(e)=>{const willComplete=!done;if(willComplete&&periodIsCurrent(cadence,focusDate)){const dot=e.currentTarget.querySelector('.habit__daydot');const r=(dot||e.currentTarget).getBoundingClientRect();fireConfetti(r.left+r.width/2,r.top+r.height/2);}toggleHabit(h.id,cadence,focusDate);}}>
                      <span className="habit__daydot"><Icon name="check" size={9}/></span>
                      <span className="habit__periodlbl">{lbl}</span>
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
      {habits.length>0&&<button className="sidebar__editbtn" onClick={onManageHabits} style={{marginTop:10}}><Icon name="edit" size={13}/>Edit habits</button>}
    </div>
  );
}

// ===== SIDEBAR SECTION =====
function SidebarSection({label,children}){
  const [open,setOpen]=useState(true);
  return(
    <div className="sidebar__group">
      <div className="sidebar__grouphd">
        <button className="sidebar__sechd" onClick={()=>setOpen(o=>!o)}>
          <span className="sidebar__lbl">{label}</span>
          <span className="sidebar__caret" data-open={open?'true':'false'}><Icon name="chevron" size={12}/></span>
        </button>
      </div>
      {open&&<div className="sidebar__secbody">{children}</div>}
    </div>
  );
}

// Format a timestamp into a short "X ago" label for the sync indicator.
// Returns 'Just now', 'Xs ago', 'Xm ago', 'Xh ago'.
function relTime(ts,now){
  if(!ts)return '';
  const diff=Math.max(0,Math.floor((now-ts)/1000));
  if(diff<5)return 'Just now';
  if(diff<60)return diff+'s ago';
  if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return Math.floor(diff/86400)+'d ago';
}

// ===== FILTER SIDEBAR =====
function FilterSidebar({open,onToggle,activeWeights,toggleWeight,activeTag,setTag,tags,focusDate,setFocusDate,tasks,habits,habitLog,toggleHabit,onManageHabits,onManageTags,query,setQuery,width,resizing,onSync,syncing,saveError}){
  const activeCount=activeWeights.length+(activeTag===null?0:1);
  const taskDays=useMemo(()=>{const s=new Set();tasks.forEach(t=>{if(t.date)s.add(t.date);});return s;},[tasks]);
  return(
    <aside className="sidebar" data-open={open?'true':'false'} style={open&&width?{width:width+'px',transition:resizing?'none':undefined}:undefined}>
      <div className="sidebar__head">
        {open?<><span className="sidebar__title">Filters</span>{activeCount>0&&<span className="sidebar__badge">{activeCount}</span>}</>:<>{activeCount>0?<span className="sidebar__badge">{activeCount}</span>:<span/>}</>}
        <div className="sidebar__head-actions">
          <button className="sidebar__toggle" onClick={onToggle} title={open?'Collapse':'Expand'}><Icon name={open?'collapseL':'expandR'} size={19}/></button>
        </div>
      </div>
      <div className="sidebar__content">
        <div className="sidesearch">
          <span className="sidesearch__ico"><Icon name="search" size={15}/></span>
          <input className="sidesearch__input" type="text" value={query} placeholder="Search tasks…" onChange={(e)=>setQuery(e.target.value)}/>
          {query&&<button className="sidesearch__clear" onClick={()=>setQuery('')}><Icon name="x" size={13}/></button>}
        </div>
        <SidebarSection label="Calendar"><MiniCalendar focusDate={focusDate} setFocusDate={setFocusDate} taskDays={taskDays}/></SidebarSection>
        <SidebarSection label="Habits"><HabitTracker habits={habits} focusDate={focusDate} habitLog={habitLog} toggleHabit={toggleHabit} onManageHabits={onManageHabits}/></SidebarSection>
        <SidebarSection label="Weight">
          <div className="sidebar__chips">
            {WEIGHTS.map(w=><button key={w} className="chip chip--weight chip--side" data-weight={w} data-on={activeWeights.includes(w)?'true':'false'} style={{'--w':`var(--w-${w})`}} onClick={()=>toggleWeight(w)}><span className="chip__dot"/>{WEIGHT_LABELS[w]}</button>)}
          </div>
        </SidebarSection>
        <SidebarSection label="Tags">
          <div className="sidebar__chips">
            <button className="chip chip--side" data-on={activeTag===null?'true':'false'} onClick={()=>setTag(null)}>All</button>
            {tags.map(t=><button key={t} className="chip chip--side" data-on={activeTag===t?'true':'false'} onClick={()=>setTag(t)}>{t}</button>)}
          </div>
          <button className="sidebar__editbtn" onClick={onManageTags}><Icon name="edit" size={13}/>Edit tags</button>
        </SidebarSection>
      </div>
    </aside>
  );
}

// ===== FILTER CHIPS =====
function FilterChips({weights,tag,query,clearWeight,clearTag,clearQuery}){
  if(weights.length===0&&tag===null&&!query)return null;
  return(
    <div className="filterbar">
      {query&&<button type="button" className="filterbar__chip" data-kind="search" onClick={clearQuery}><Icon name="search" size={12}/>Search: "{query}"<span className="filterbar__x"><Icon name="x" size={12}/></span></button>}
      {weights.map(w=><button key={w} type="button" className="filterbar__chip" data-kind="weight" style={{'--w':`var(--w-${w})`}} onClick={()=>clearWeight(w)}><span className="filterbar__dot"/>Weight: {WEIGHT_LABELS[w]}<span className="filterbar__x"><Icon name="x" size={12}/></span></button>)}
      {tag!==null&&<button type="button" className="filterbar__chip" data-kind="tag" onClick={clearTag}>Tag: {tag}<span className="filterbar__x"><Icon name="x" size={12}/></span></button>}
    </div>
  );
}

// ===== TASK CARD =====
function Checkbox({stage,completed,onCycle,weight}){
  // 3-state status control: todo (empty) -> doing (half) -> complete (check) -> todo.
  // "completed" shows the check even while the task waits in its column for subtasks.
  const vstate=(completed||stage==='done')?'done':stage;
  const label=vstate==='done'?'Mark as not done':vstate==='todo'?'Mark in progress':'Mark complete';
  return(
    <button className="check" data-stage={vstate} style={{'--w':`var(--w-${weight||'medium'})`}}
      onClick={(e)=>{e.stopPropagation();onCycle(e);}}
      title={label}
      aria-label={label}>
      <span className="check__half" aria-hidden="true"/>
      <span className="check__tick"><Icon name="check" size={10}/></span>
    </button>
  );
}
// Grip-based pointer reorder for subtask lists — mouse + touch, geometric hit-testing + edge auto-scroll.
function useGripReorder(reorder){
  const [st,setSt]=useState(null);
  const ref=useRef(null);
  const raf=useRef(0);
  const auto=useRef({el:null,dy:0});
  const gripDown=useCallback((e,index,itemSel)=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    e.stopPropagation();
    if(e.pointerType!=='touch') e.preventDefault();
    const isTouch=e.pointerType==='touch';
    const grip=e.currentTarget;
    try{grip.setPointerCapture(e.pointerId);}catch(_){}
    const s={from:index,over:index,ly:e.clientY,sy:e.clientY,armed:!isTouch,canceled:false,holdTimer:null};
    ref.current=s;
    function items(){ const first=grip.closest(itemSel); const p=first&&first.parentElement; return p?[...p.children].filter(c=>c.matches&&c.matches(itemSel)):[]; }
    function overAt(y){ const its=items(); for(let k=0;k<its.length;k++){ const r=its[k].getBoundingClientRect(); if(y<r.top+r.height/2) return k; } return its.length?its.length-1:null; }
    function findScroller(){ let el=grip.closest(itemSel); el=el&&el.parentElement; while(el&&el!==document.body){ const cs=getComputedStyle(el); if(/(auto|scroll)/.test(cs.overflowY)&&el.scrollHeight>el.clientHeight+2)return el; el=el.parentElement; } return null; }
    const sc=findScroller();
    function tick(){ const a=auto.current; if(a.el&&a.dy){ a.el.scrollTop+=a.dy; const s2=ref.current; if(s2){ const o=overAt(s2.ly); if(o!=null&&o!==s2.over){s2.over=o; setSt({from:s2.from,over:o});} } } raf.current=requestAnimationFrame(tick); }
    function edge(y){ auto.current.el=sc; auto.current.dy=0; if(!sc)return; const r=sc.getBoundingClientRect(); const E=44; if(y<r.top+E)auto.current.dy=-9; else if(y>r.bottom-E)auto.current.dy=9; }
    function begin(){ const s2=ref.current; if(!s2||s2.canceled||s2.armed&&s2.started)return; s2.armed=true; s2.started=true; s2.holdTimer=null; document.body.classList.add('heft-dragging'); document.body.style.userSelect='none'; if(isTouch&&navigator.vibrate){try{navigator.vibrate(8);}catch(_){}} setSt({from:s2.from,over:s2.over}); cancelAnimationFrame(raf.current); raf.current=requestAnimationFrame(tick); }
    function block(ev){ if(ref.current&&ref.current.armed) ev.preventDefault(); }
    window.addEventListener('touchmove',block,{passive:false});
    function cleanup(){
      cancelAnimationFrame(raf.current); raf.current=0; auto.current={el:null,dy:0};
      window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); window.removeEventListener('pointercancel',up); window.removeEventListener('touchmove',block,{passive:false});
      document.body.classList.remove('heft-dragging'); document.body.style.userSelect='';
      try{grip.releasePointerCapture(e.pointerId);}catch(_){}
    }
    function move(ev){ const s2=ref.current; if(!s2)return;
      if(!s2.armed){ if(Math.abs(ev.clientY-s2.sy)>10){ s2.canceled=true; if(s2.holdTimer){clearTimeout(s2.holdTimer);s2.holdTimer=null;} ref.current=null; cleanup(); setSt(null); } return; }
      ev.preventDefault(); s2.ly=ev.clientY; const o=overAt(ev.clientY); if(o!=null&&o!==s2.over){s2.over=o; setSt({from:s2.from,over:o});} edge(ev.clientY);
    }
    function up(ev){ const s2=ref.current; ref.current=null;
      if(s2&&s2.holdTimer){clearTimeout(s2.holdTimer);s2.holdTimer=null;}
      cleanup();
      if(s2&&s2.armed&&s2.over!=null&&s2.from!==s2.over) reorder(s2.from,s2.over);
      setSt(null);
    }
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',up); window.addEventListener('pointercancel',up);
    if(isTouch){ s.holdTimer=setTimeout(begin,200); } else { begin(); }
  },[reorder]);
  return [st,gripDown];
}
function TaskCard({task,onToggle,onCycle,onOpen,draggable,onPointerDown,onSubToggle,onSubReorder,onSubDelete,onStepToggle,defaultExpanded}){
  const [expanded,setExpanded]=useState(defaultExpanded!==false);
  const [subSt,subGrip]=useGripReorder(onSubReorder);
  const [pendingDelete,setPendingDelete]=useState(null);
  const done=task.completed||task.stage==='done';const weight=task.weight||'none';
  const pendingSubs=done&&task.stage!=='done'&&(task.subtasks||[]).some(s=>!s.done);
  return(<React.Fragment>
    <div className="taskgroup">
      <article className="card" data-flip-id={task.id} data-weight={weight} data-done={done?'true':'false'}
        tabIndex={0} role="button" aria-label={task.name+' — '+(weight!=='none'?weight+' weight, ':'')+(done?'done':STAGE_LABELS[task.stage]||task.stage)}
        style={{'--w':`var(--w-${weight})`,'touchAction':draggable?'pan-y':'auto'}}
        onPointerDown={onPointerDown}
        onKeyDown={(e)=>{if((e.key==='Enter'||e.key===' ')&&e.target===e.currentTarget){e.preventDefault();onOpen&&onOpen(task);}}}
        onClick={()=>{if(Date.now()-(window.__heftDragEnd||0)<350)return;onOpen&&onOpen(task);}}>
        <span className="card__rail" aria-hidden="true"/>
        <div className="card__in">
          <header className="card__head">
            <span data-nodrag="true"><Checkbox stage={task.stage} completed={task.completed} onCycle={onCycle} weight={weight}/></span>
            <h4 className="card__name">{task.name}</h4>
            <span className="card__grip" aria-hidden="true"><Icon name="grip" size={18}/></span>
          </header>
          {task.notes&&<p className="card__notes">{task.notes}</p>}
          {task.tag&&<span className="card__tag">{task.tag}</span>}
          {(task.parentId||((task.childIds||[]).length>0))&&(
            <span className="card__link" role="note" aria-label={task.parentId?'Promoted from another task':'Has '+(task.childIds||[]).length+' promoted task'+((task.childIds||[]).length===1?'':'s')} title={task.parentId?'Promoted out of another task':'Promoted subtask'+((task.childIds||[]).length===1?'':'s')+' live as their own task'+((task.childIds||[]).length===1?'':'s')}>
              <Icon name="link" size={10}/>{task.parentId?'Promoted':'Linked '+(task.childIds||[]).length}
            </span>
          )}
          {(task.subtasks||[]).length>0&&(<button type="button" className="card__subs" data-expanded={expanded?'true':'false'} data-nodrag="true" style={{'--w':`var(--w-${weight})`}} onClick={(e)=>{e.stopPropagation();setExpanded(o=>!o);}}><span style={{display:'inline-flex',transition:'transform .15s',transform:expanded?'rotate(90deg)':'rotate(0deg)'}}><Icon name="chevron" size={12}/></span><Icon name="subtasks" size={13}/><span>{(task.subtasks||[]).filter(s=>s.done).length+'/'+(task.subtasks||[]).length+' subtask'+((task.subtasks||[]).length!==1?'s':'')}</span></button>)}
          {pendingSubs&&<p className="card__pending"><Icon name="checkcircle" size={12}/>Completed — moves to Done when subtasks finish</p>}
        </div>
      </article>
      {expanded&&(task.subtasks||[]).length>0&&(
        <div className="subtree">
          {(task.subtasks||[]).map((s,i)=>{
            const steps=stepsOf(s);const stepsDone=steps.filter(p=>p.done).length;
            return(
            <div key={s.id} className="subtree__item" data-flip-id={task.id+':sub:'+s.id} data-subindex={i} data-hassteps={steps.length>0?'true':'false'} data-dragging={subSt&&subSt.from===i?'true':'false'} data-droptarget={subSt&&subSt.over===i&&subSt.from!==i?'true':'false'}>
              <div className="subcard" data-done={s.done?'true':'false'}
                style={{'--w':`var(--w-${weight})`}}>
                <button type="button" className="subcard__check" aria-label={(s.done?'Uncheck subtask: ':'Complete subtask: ')+s.name} data-done={s.done?'true':'false'} onClick={(e)=>{e.stopPropagation();onSubToggle&&onSubToggle(s.id,e);}}>{s.done&&<Icon name="check" size={11}/>}</button>
                <span className="subcard__name" onClick={(e)=>{e.stopPropagation();onSubToggle&&onSubToggle(s.id,e);}}>{s.name}</span>
                {steps.length>0&&<span className="subcard__steps" aria-label={stepsDone+' of '+steps.length+' steps done'}>{stepsDone}/{steps.length}</span>}
                <button type="button" className="subcard__trash" title="Delete subtask" onClick={(e)=>{e.stopPropagation();setPendingDelete(s);}}>
                  <Icon name="trash" size={14}/>
                </button>
                <span className="subcard__grip" title="Drag to reorder" onPointerDown={(e)=>subGrip(e,i,'.subtree__item')} style={{touchAction:'pan-y',cursor:'grab'}}><Icon name="grip" size={16}/></span>
              </div>
              {steps.length>0&&(
                <ul className="steptree" role="list" aria-label={'Steps for '+s.name}>
                  {steps.map(p=>(
                    <li key={p.id} className="steprow" data-done={p.done?'true':'false'}>
                      <button type="button" className="steprow__check" data-done={p.done?'true':'false'} aria-label={(p.done?'Uncheck step: ':'Complete step: ')+p.name} data-nodrag="true" onClick={(e)=>{e.stopPropagation();onStepToggle&&onStepToggle(s.id,p.id);}}>{p.done&&<Icon name="check" size={9}/>}</button>
                      <span className="steprow__name">{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>);
          })}
        </div>
      )}
    </div>
    {pendingDelete&&(
      <div className="subdel-scrim" onMouseDown={()=>setPendingDelete(null)}>
        <div className="subdel-panel" onMouseDown={(e)=>e.stopPropagation()}>
          <div className="subdel-panel__title">Delete subtask?</div>
          <div className="subdel-panel__sub">Remove <span className="subdel-panel__name">&ldquo;{pendingDelete.name}&rdquo;</span><br/>This can&#x27;t be undone.</div>
          <div className="subdel-panel__btns">
            <button className="btn" onClick={()=>setPendingDelete(null)}>Cancel</button>
            <button className="btn btn--primary" style={{background:'#c0392b',borderColor:'#c0392b'}} onClick={(e)=>{e.stopPropagation();onSubDelete&&onSubDelete(pendingDelete.id);setPendingDelete(null);}}>Yes, delete</button>
          </div>
        </div>
      </div>
    )}
  </React.Fragment>);
}

// ===== COL SORT =====
function ColSort({sort,setSort}){
  const [open,setOpen]=useState(false);
  return(
    <div className="colsort">
      <button className="colsort__btn" data-on={sort!=='created'?'true':'false'} onClick={(e)=>{e.stopPropagation();setOpen(o=>!o);}} title="Sort"><Icon name="sort" size={15}/></button>
      {open&&<React.Fragment>
        <div className="colsort__scrim" onClick={()=>setOpen(false)}/>
        <div className="colsort__menu">
          <div className="colsort__hd">Sort by</div>
          {SORTS.map(s=><button key={s.id} className="colsort__opt" data-on={sort===s.id?'true':'false'} onClick={()=>{setSort(s.id);setOpen(false);}}><span>{s.label}</span>{sort===s.id&&<Icon name="check" size={14}/>}</button>)}
        </div>
      </React.Fragment>}
    </div>
  );
}



function BoardEmptyState({onAddTask}){
  return(
    <div className="board-empty">
      <div className="board-empty__mark"><HeftMark size={44}/></div>
      <h2 className="board-empty__title">Your day starts here.</h2>
      <p className="board-empty__sub">Add a task and give it a weight — Light, Medium, Heavy, or Extra — to see how much you're really carrying.</p>
      <div className="board-empty__features">
        <span className="board-empty__chip"><span className="board-empty__chip-dot" style={{background:'var(--w-medium)'}}/>Weight System</span>
        <span className="board-empty__chip"><span className="board-empty__chip-dot" style={{background:'var(--w-light)'}}/>Daily Habits</span>
        <span className="board-empty__chip"><span className="board-empty__chip-dot" style={{background:'var(--accent)'}}/>Cross-device Sync</span>
      </div>
      <button className="board-empty__cta" onClick={()=>onAddTask('todo')}>
        <Icon name="plus" size={16}/>Add your first task
      </button>
      <p className="board-empty__tip"><Icon name="lightbulb" size={13}/>Drag tasks between columns as you progress.</p>
    </div>
  );
}

// Unified pointer drag — mouse + touch (iPhone/iPad). On touch a short long-press
// arms the drag so quick vertical swipes still scroll the board; once armed we block
// native scrolling and auto-scroll at the edges so vertically-stacked columns are reachable.
function usePointerDrag(setTasks,setDragId,boardRef){
  const ghostRef=useRef(null);
  const stateRef=useRef(null);
  const rafRef=useRef(0);
  const autoRef=useRef({el:null,dy:0});
  const onPD=useCallback((e,task)=>{
    if(e.target.closest('[data-nodrag]'))return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    const isTouch=e.pointerType==='touch';
    const cap=e.currentTarget;
    const card=e.currentTarget;
    try{cap.setPointerCapture(e.pointerId);}catch(_){}
    const st={id:task.id,name:task.name,stage:task.stage,backlog:isBacklog(task),sx:e.clientX,sy:e.clientY,lx:e.clientX,ly:e.clientY,started:false,armed:!isTouch,canceled:false,lastCol:null,holdTimer:null};
    stateRef.current=st;
    function blockScroll(ev){ if(stateRef.current&&stateRef.current.armed&&stateRef.current.started) ev.preventDefault(); }
    window.addEventListener('touchmove',blockScroll,{passive:false});
    if(isTouch){
      st.holdTimer=setTimeout(()=>{
        if(!stateRef.current||st.canceled)return;
        st.armed=true; beginDrag(st.lx,st.ly);
        if(navigator.vibrate){try{navigator.vibrate(10);}catch(_){}}
      },200);
    }
    function beginDrag(x,y){
      if(!stateRef.current||st.started)return;
      st.started=true; setDragId(st.id);
      if(card){card.style.opacity='.4';card.style.transition='opacity .12s';}
      const g=document.createElement('div');
      g.className='card-drag-ghost'; g.textContent=st.name;
      g.style.left=(x-90)+'px'; g.style.top=(y-24)+'px';
      document.body.appendChild(g); ghostRef.current=g;
      document.body.style.userSelect='none';
      document.body.classList.add('heft-dragging');
      const col=highlight(x,y); if(col)st.lastCol=col.dataset.stage;
      startAuto();
    }
    function moveGhost(x,y){ const g=ghostRef.current; if(g){g.style.left=(x-90)+'px';g.style.top=(y-24)+'px';} }
    function highlight(x,y){
      document.querySelectorAll('.col').forEach(c=>c.setAttribute('data-over','false'));
      const g=ghostRef.current; if(g)g.style.display='none';
      const el=document.elementFromPoint(x,y);
      if(g)g.style.display='';
      const col=el&&el.closest('.col');
      if(col)col.setAttribute('data-over','true');
      return col;
    }
    function scrollerAt(x,y){
      let el=document.elementFromPoint(x,y);
      while(el&&el!==document.body&&el!==document.documentElement){
        const cs=getComputedStyle(el);
        if(/(auto|scroll)/.test(cs.overflowY)&&el.scrollHeight>el.clientHeight+2)return el;
        el=el.parentElement;
      }
      return document.querySelector('.board');
    }
    function computeAuto(x,y){
      const el=scrollerAt(x,y); autoRef.current.el=el; autoRef.current.dy=0;
      if(!el)return;
      const r=el.getBoundingClientRect(); const EDGE=70;
      if(y<r.top+EDGE){const p=Math.min(1,(r.top+EDGE-y)/EDGE);autoRef.current.dy=-Math.ceil(16*p);}
      else if(y>r.bottom-EDGE){const p=Math.min(1,(y-(r.bottom-EDGE))/EDGE);autoRef.current.dy=Math.ceil(16*p);}
    }
    function startAuto(){ if(rafRef.current)return;
      const loop=()=>{ const a=autoRef.current;
        if(a.el&&a.dy){ const before=a.el.scrollTop; a.el.scrollTop+=a.dy;
          if(a.el.scrollTop!==before&&stateRef.current){ const col=highlight(st.lx,st.ly); if(col)st.lastCol=col.dataset.stage; } }
        rafRef.current=requestAnimationFrame(loop); };
      rafRef.current=requestAnimationFrame(loop);
    }
    function stopAuto(){ if(rafRef.current){cancelAnimationFrame(rafRef.current);rafRef.current=0;} autoRef.current={el:null,dy:0}; }
    function onMove(ev){
      if(!stateRef.current)return;
      st.lx=ev.clientX; st.ly=ev.clientY;
      const dist=Math.hypot(ev.clientX-st.sx,ev.clientY-st.sy);
      if(!st.armed){
        if(dist>10){ st.canceled=true; teardown(ev); stateRef.current=null; }
        return;
      }
      if(!st.started){ if(dist>4)beginDrag(ev.clientX,ev.clientY); else return; }
      ev.preventDefault();
      moveGhost(ev.clientX,ev.clientY);
      const col=highlight(ev.clientX,ev.clientY); if(col)st.lastCol=col.dataset.stage;
      computeAuto(ev.clientX,ev.clientY);
    }
    function onUp(ev){
      const s=stateRef.current; stateRef.current=null; teardown(ev);
      if(s&&st.started){
        window.__heftDragEnd=Date.now();
        let ns=st.lastCol;
        if(!ns){const col=highlight(ev.clientX,ev.clientY);if(col)ns=col.dataset.stage;}
        document.querySelectorAll('.col').forEach(c=>c.setAttribute('data-over','false'));
        const board=boardRef&&boardRef.current;
        if(ns==='backlog'){
          // Dropping a dated card into Backlog clears its date. Stage is preserved.
          if(!st.backlog){setTasks(ts=>ts.map(t=>t.id===st.id?{...t,date:null}:t));logEvent('backlog_added',{via:'drag',taskId:st.id,from:st.stage});}
        }else if(ns&&(ns!==st.stage||st.backlog)){
          const dk=board?board.focusKey:null;
          const commit=()=>{
            if(ns==='done')fireConfetti(ev.clientX,ev.clientY,1);
            setTasks(ts=>ts.map(t=>{
              if(t.id!==st.id)return t;
              // A card pulled out of Backlog lands on the day the board is showing.
              const dated=st.backlog&&dk?{date:dk}:{};
              if(ns==='done'){const subs=t.subtasks||[];const allDone=subs.length===0||subs.every(x=>x.done);return{...t,...dated,completed:true,stage:allDone?'done':'doing'};}
              return{...t,...dated,stage:ns,completed:false};
            }));
          };
          const commitLogged=()=>{
            commit();
            if(st.backlog)logEvent('backlog_pulled',{via:'drag',taskId:st.id,to:ns});
            if(ns!==st.stage)logEvent('task_moved',{taskId:st.id,from:st.backlog?'backlog':st.stage,to:ns,via:'drag'});
          };
          if(board&&board.admit)board.admit(ns,st.id,commitLogged);else commitLogged();
        }
        setDragId(null);
      }
    }
    function teardown(ev){
      if(st.holdTimer){clearTimeout(st.holdTimer);st.holdTimer=null;}
      try{cap.releasePointerCapture(ev.pointerId);}catch(_){}
      window.removeEventListener('pointermove',onMove);
      window.removeEventListener('pointerup',onUp);
      window.removeEventListener('pointercancel',onUp);
      window.removeEventListener('touchmove',blockScroll,{passive:false});
      stopAuto();
      document.body.style.userSelect='';
      document.body.classList.remove('heft-dragging');
      if(card){card.style.opacity='';card.style.transition='';}
      if(ghostRef.current){ghostRef.current.remove();ghostRef.current=null;}
      document.querySelectorAll('.col').forEach(c=>c.setAttribute('data-over','false'));
    }
    window.addEventListener('pointermove',onMove,{passive:false});
    window.addEventListener('pointerup',onUp);
    window.addEventListener('pointercancel',onUp);
  },[setTasks,setDragId,boardRef]);
  return onPD;
}

// ===== KANBAN =====
function Column({stage,tasks,items,setTasks,dragId,setDragId,sort,setSort,onOpenTask,onAddTask,onCycle,onPD,defaultExpanded,limit,onScrolled}){
  const list=sortTasks(items||tasks.filter(t=>t.stage===stage),sort);
  const isBack=stage==='backlog';
  const lim=(!isBack&&stage!=='done'&&limit>0)?limit:0; // Backlog and Done are never capped
  const level=lim?(list.length<lim?'under':(list.length===lim?'at':'over')):'under';
  const pct=lim?Math.min(100,Math.round((list.length/lim)*100)):0;
  return(
    <section className="col" data-stage={stage} data-wip={lim?level:undefined}>
      <div className="col__head">
        <span className="col__icon" data-stage={stage}><Icon name={STAGE_ICONS[stage]} size={15}/></span>
        <span className="col__name">{STAGE_LABELS[stage]}</span>
        <span className="col__count" data-wip={lim?level:undefined} aria-label={lim?(list.length+' of '+lim+', work in progress limit'):(list.length+' tasks')}><span className="counttick" key={lim?list.length+'/'+lim:''+list.length}>{lim?list.length+'/'+lim:list.length}</span></span>
        <span className="col__spacer"/>
        <button className="col__add" title={isBack?'Add to Backlog':'Add task'} aria-label={isBack?'Add to Backlog':'Add task to '+STAGE_LABELS[stage]} onClick={()=>onAddTask(stage)}><Icon name="plus" size={16}/></button>
        {!isBack&&<ColSort sort={sort} setSort={setSort}/>}
      </div>
      {lim>0&&<div className="col__meter" data-wip={level} aria-hidden="true"><span className="col__meter__fill" style={{width:pct+'%'}}/></div>}
      <div className="col__body" onScroll={onScrolled}>
        {list.length===0?(
          isBack?(
            <div className="col__empty">Nothing parked</div>
          ):stage==='todo'&&!(tasks&&tasks.length)?(
            <div className="col__empty-cta">
              <div className="col__empty-cta__icon"><Icon name="plus" size={18}/></div>
              <p className="col__empty-cta__title">Add your first task</p>
              <p className="col__empty-cta__body">Tap <strong>+</strong> above or the <strong>Add task</strong> button to get started. Assign a weight to show how much this task costs you.</p>
              <div className="col__empty-cta__features">
                <span className="col__empty-cta__pill"><span className="col__empty-cta__pill-dot" style={{background:'var(--w-light)'}}/>Light</span>
                <span className="col__empty-cta__pill"><span className="col__empty-cta__pill-dot" style={{background:'var(--w-medium)'}}/>Medium</span>
                <span className="col__empty-cta__pill"><span className="col__empty-cta__pill-dot" style={{background:'var(--w-heavy)'}}/>Heavy</span>
                <span className="col__empty-cta__pill"><span className="col__empty-cta__pill-dot" style={{background:'var(--w-extra)'}}/>Extra</span>
              </div>
            </div>
          ):(
            <div className="col__empty">Nothing here</div>
          )
        ):list.map(t=>(
          <TaskCard key={t.id} task={t}
            onCycle={(e)=>onCycle(t.id,e)}
            onOpen={onOpenTask}
            defaultExpanded={defaultExpanded}
            draggable={true}
            onPointerDown={onPD?(e)=>onPD(e,t):undefined}
            onSubToggle={(subId,e)=>{const cur=tasks.find(v=>v.id===t.id);if(cur&&cur.completed&&cur.stage!=='done'&&e){const after=toggleSubAndSink(cur.subtasks,subId);if(after.length>0&&after.every(s=>s.done)){const r=e.currentTarget.getBoundingClientRect();fireConfetti(r.left+r.width/2,r.top+r.height/2,1.2);}}setTasks(ts=>ts.map(x=>x.id!==t.id?x:patchTaskSubToggle(x,subId)));}}
            onSubReorder={(from,to)=>setTasks(ts=>ts.map(x=>{if(x.id!==t.id)return x;const arr=(x.subtasks||[]).slice();if(to<0||to>=arr.length||from===to)return x;const[m]=arr.splice(from,1);arr.splice(to,0,m);return{...x,subtasks:arr};}))}
            onSubDelete={(subId)=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,subtasks:(x.subtasks||[]).filter(s=>s.id!==subId)}:x))}
            onStepToggle={(subId,stepId)=>setTasks(ts=>ts.map(x=>x.id!==t.id?x:{...x,subtasks:(x.subtasks||[]).map(s=>s.id!==subId?s:{...s,steps:stepsOf(s).map(p=>p.id===stepId?{...p,done:!p.done}:p)})}))}/>
        ))}
      </div>
      {list.length>0&&(
        <div className="col__foot">
          {(()=>{const c={light:0,medium:0,heavy:0,extra:0};list.forEach(t=>{const w=t.weight||'none';if(c[w]!==undefined)c[w]++;});const parts=[];['light','medium','heavy','extra'].forEach(w=>{if(c[w]>0)parts.push(<span key={w} className="col__foot__w" style={{'--w':`var(--w-${w})`}}><span className="col__foot__dot"/>{c[w]} {WEIGHT_LABELS[w].toLowerCase()}</span>);});return parts;})()}
        </div>
      )}
    </section>
  );
}
function KanbanView({tasks,backlog,setTasks,sort,setSort,onOpenTask,onAddTask,onCycle,defaultExpanded,wipLimits,boardRef,onColScroll}){
  const [dragId,setDragId]=useState(null);
  const onPD=usePointerDrag(setTasks,setDragId,boardRef);
  const back=backlog||[];
  if(tasks.length===0&&back.length===0)return<BoardEmptyState onAddTask={onAddTask}/>;
  const lims=wipLimits||WIP_DEFAULT;
  return(
    <div className="kanban" data-dragging={dragId?'true':'false'}>
      {STAGES.map(stg=><Column key={stg} stage={stg} tasks={tasks} setTasks={setTasks} dragId={dragId} setDragId={setDragId} sort={sort} setSort={setSort} onOpenTask={onOpenTask} onAddTask={onAddTask} onCycle={onCycle} onPD={onPD} defaultExpanded={defaultExpanded} limit={lims[stg]||0} onScrolled={onColScroll?()=>onColScroll(stg):undefined}/>)}
      {/* Fourth lane: undated work. Stacks under the others on mobile, same as every column. */}
      <Column key="backlog" stage="backlog" tasks={tasks} items={back} setTasks={setTasks} dragId={dragId} setDragId={setDragId} sort={sort} setSort={setSort} onOpenTask={onOpenTask} onAddTask={onAddTask} onCycle={onCycle} onPD={onPD} defaultExpanded={defaultExpanded} limit={0} onScrolled={onColScroll?()=>onColScroll('backlog'):undefined}/>
    </div>
  );
}

// ===== WEIGHT VIEW =====
function Lane({weight,tasks,setTasks,onOpenTask,onCycle,defaultExpanded}){
  const list=tasks.filter(t=>t.weight===weight);
  const counts={todo:0,doing:0,done:0};list.forEach(t=>{if(counts[t.stage]!==undefined)counts[t.stage]++;});
  const total=list.length;const donePct=total?Math.round((counts.done/total)*100):0;
  const wVar={'--w':`var(--w-${weight})`};
  return(
    <section className="lane" data-weight={weight} style={wVar}>
      <div className="lane__head">
        <div className="lane__titlewrap"><span className="lane__chip"><span className="lane__dot"/>{WEIGHT_LABELS[weight]}</span><span className="lane__desc">{WEIGHT_DESC[weight]}</span></div>
        <span className="lane__count"><span className="counttick" key={total}>{total}</span></span>
      </div>
      <div className="lane__bar"><div className="lane__fill" style={{width:donePct+'%'}}/></div>
      <div className="lane__legend"><span>{counts.todo} to do</span><span>·</span><span>{counts.doing} doing</span><span>·</span><span>{counts.done} done</span></div>
      <div className="lane__body">
        {total===0?<div className="col__empty">No {WEIGHT_LABELS[weight].toLowerCase()} tasks</div>:list.map(t=>(
          <TaskCard key={t.id} task={t}
            onCycle={(e)=>onCycle(t.id,e)}
            onOpen={onOpenTask}
            defaultExpanded={defaultExpanded}
            onSubToggle={(subId,e)=>{const cur=tasks.find(v=>v.id===t.id);if(cur&&cur.completed&&cur.stage!=='done'&&e){const after=toggleSubAndSink(cur.subtasks,subId);if(after.length>0&&after.every(s=>s.done)){const r=e.currentTarget.getBoundingClientRect();fireConfetti(r.left+r.width/2,r.top+r.height/2,1.2);}}setTasks(ts=>ts.map(x=>x.id!==t.id?x:patchTaskSubToggle(x,subId)));}}
            onSubReorder={(from,to)=>setTasks(ts=>ts.map(x=>{if(x.id!==t.id)return x;const arr=(x.subtasks||[]).slice();if(to<0||to>=arr.length||from===to)return x;const[m]=arr.splice(from,1);arr.splice(to,0,m);return{...x,subtasks:arr};}))}
            onSubDelete={(subId)=>setTasks(ts=>ts.map(x=>x.id===t.id?{...x,subtasks:(x.subtasks||[]).filter(s=>s.id!==subId)}:x))}
            onStepToggle={(subId,stepId)=>setTasks(ts=>ts.map(x=>x.id!==t.id?x:{...x,subtasks:(x.subtasks||[]).map(s=>s.id!==subId?s:{...s,steps:stepsOf(s).map(p=>p.id===stepId?{...p,done:!p.done}:p)})}))}/>
        ))}
      </div>
    </section>
  );
}
function WeightView({tasks,setTasks,onOpenTask,onCycle,defaultExpanded}){
  return<div className="weightview">{WEIGHTS.map(w=><Lane key={w} weight={w} tasks={tasks} setTasks={setTasks} onOpenTask={onOpenTask} onCycle={onCycle} defaultExpanded={defaultExpanded}/>)}</div>;
}

// ===== TASK MODAL =====
function TaskModal({initial,tags:initTags,onSave,onDelete,onClose,onDuplicate,onMoveToDate,onSaveAsTemplate,onPromote}){
  const [confirmDel,setConfirmDel]=useState(false);
  const editing=!!(initial&&initial.id&&initial.name);
  const [name,setName]=useState(initial?.name||'');
  const [weight,setWeight]=useState(initial?.weight||'medium');
  const [stage,setStage]=useState((initial?.completed||initial?.stage==='done')?'done':(initial?.stage||'todo'));
  const [tag,setTag]=useState(initial?.tag||'');
  const [notes,setNotes]=useState(initial?.notes||'');
  const [showNotes,setShowNotes]=useState(!!(initial?.notes));
  const [date,setDate]=useState((initial&&initial.date)||todayKeyNow());
  const [backlog,setBacklog]=useState(initial?initial.date===null:false);
  const [showCal,setShowCal]=useState(false);
  const [showStage,setShowStage]=useState(false);
  const [showMore,setShowMore]=useState(false);
  const [subtasks,setSubtasks]=useState(initial?.subtasks||[]);
  const [subDraft,setSubDraft]=useState('');
  const subInputRef=useRef(null);
  const [stepFor,setStepFor]=useState(null); // id of the subtask currently taking a new Step
  const [stepDraft,setStepDraft]=useState('');
  const stepInputRef=useRef(null);
  const [tags,setTags]=useState(initTags||[]);
  const [addingTag,setAddingTag]=useState(false);
  const [tagDraft,setTagDraft]=useState('');
  const [subSt2,subGrip2]=useGripReorder(moveSub);
  function addSub(){const v=subDraft.trim();if(!v)return;if(subtasks.length>=MAX_SUBS)return;setSubtasks(arr=>[...arr,{id:uid(),name:v,done:false,steps:[]}]);setSubDraft('');logEvent('subtask_added',{taskId:(initial&&initial.id)||null,count:subtasks.length+1});if(subInputRef.current)subInputRef.current.focus();}
  // ── Steps: the third and final level. Capped at MAX_STEPS, mirroring addSub. ──
  function addStep(subId){
    const v=stepDraft.trim();if(!v)return;
    setSubtasks(arr=>arr.map(s=>{
      if(s.id!==subId)return s;
      const cur=stepsOf(s);
      if(cur.length>=MAX_STEPS)return s;
      return{...s,steps:[...cur,{id:uid(),name:v,done:false}]};
    }));
    setStepDraft('');
    logEvent('step_added',{taskId:(initial&&initial.id)||null,subId:subId});
    if(stepInputRef.current)stepInputRef.current.focus();
  }
  function toggleStep(subId,stepId){setSubtasks(arr=>arr.map(s=>s.id!==subId?s:{...s,steps:stepsOf(s).map(p=>p.id===stepId?{...p,done:!p.done}:p)}));}
  function renameStep(subId,stepId,v){setSubtasks(arr=>arr.map(s=>s.id!==subId?s:{...s,steps:stepsOf(s).map(p=>p.id===stepId?{...p,name:v}:p)}));}
  function delStep(subId,stepId){setSubtasks(arr=>arr.map(s=>s.id!==subId?s:{...s,steps:stepsOf(s).filter(p=>p.id!==stepId)}));}
  // Promote a subtask into a real task. Commits the editor's current state minus that
  // subtask, then hands both halves to the board so the move is a single undo-able step.
  function promoteSub(s){
    if(!onPromote||!editing)return;
    const remaining=subtasks.filter(x=>x.id!==s.id);
    const idx=subtasks.findIndex(x=>x.id===s.id);
    const completed=stage==='done';
    const allDone=remaining.length===0||remaining.every(x=>x.done);
    const finalStage=completed?(allDone?'done':'doing'):stage;
    onPromote({
      parent:{id:initial.id,seq:initial.seq||Date.now(),date:backlog?null:(date||todayKeyNow()),name:name.trim()||initial.name,weight,stage:finalStage,completed,tag,notes:notes.trim(),subtasks:remaining},
      sub:s,index:idx,tags
    });
  }
  function commitTag(){const v=tagDraft.trim();if(v){setTags(t=>t.includes(v)?t:[...t,v]);setTag(v);}setTagDraft('');setAddingTag(false);}
  const [confirmTagDel,setConfirmTagDel]=useState(null);
  function dropTag(t){setTags(ls=>ls.filter(x=>x!==t));if(tag===t)setTag('');setConfirmTagDel(null);}
  function moveSub(from,to){setSubtasks(arr=>{if(to<0||to>=arr.length||from===to)return arr;const next=arr.slice();const[m]=next.splice(from,1);next.splice(to,0,m);return next;});}
  function save(){const trimmed=name.trim();if(!trimmed)return;const completed=stage==='done';const allDone=subtasks.length===0||subtasks.every(s=>s.done);const finalStage=completed?(allDone?'done':'doing'):stage;if(onSave)onSave({id:initial?.id||uid(),seq:initial?.seq||Date.now(),date:backlog?null:(date||todayKeyNow()),name:trimmed,weight,stage:finalStage,completed,tag,notes:notes.trim(),subtasks},tags);}
  const subDone=subtasks.filter(s=>s.done).length;
  const hasDate=editing&&!!(initial&&initial.date);
  const moveBase=new Date((initial?.date||date)+'T00:00:00');
  return(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal__panel modal__panel--task" role="dialog" aria-modal="true" aria-label="Task editor" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="modal__bar">
          <span className="modal__title">{editing?'Edit task':'New task'}</span>
          {hasDate&&(<>
            <span className="modal__divider"/>
            <span className="qdate__lbl">Move to</span>
            <div className="qdate">
              {[1,2,3].map(d=>{const dt=new Date(moveBase);dt.setDate(dt.getDate()+d);const dk=dayKey(dt);return(
                <button key={d} type="button" className="qdate__btn" data-on={date===dk?'true':'false'} title={dt.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})} onClick={()=>setDate(dk)}>
                  <span className="qdate__btn__dow">{dt.toLocaleDateString(undefined,{weekday:'short'})}</span>
                  <span className="qdate__btn__num">{dt.getDate()}</span>
                </button>
              );})}
            </div>
          </>)}
          <span className="modal__bar__spacer"/>
          {editing&&<button className="iconbtn" title="Duplicate task" aria-label="Duplicate task" onClick={()=>onDuplicate&&onDuplicate({...initial,name:name.trim()||initial.name,weight,stage,tag,date:date||initial.date,notes:notes.trim(),subtasks})}><Icon name="copy" size={17}/></button>}
          <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" size={18}/></button>
        </div>
        <div className="modal__body">
          <input className="input tm-title" value={name} autoFocus={!editing} placeholder="What needs doing?" onChange={(e)=>setName(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')save();}}/>
          <div className="field">
            <span className="field__lbl">Subtasks{subtasks.length?` (${subDone}/${subtasks.length})`:''}</span>
            {subtasks.length>0&&(
              <div className="subedit">
                {subtasks.map((s,i)=>{
                  const steps=stepsOf(s);const sd=steps.filter(p=>p.done).length;const atCap=steps.length>=MAX_STEPS;
                  return(
                  <div className="subedit__group" key={s.id} data-subindex={i} data-dragging={subSt2&&subSt2.from===i?'true':'false'} data-over={subSt2&&subSt2.over===i&&subSt2.from!==i?'true':'false'}>
                    <div className="subedit__row" data-done={s.done?'true':'false'}>
                      <span className="subedit__grip" onPointerDown={(e)=>subGrip2(e,i,'.subedit__group')} style={{touchAction:'pan-y',cursor:'grab'}}><Icon name="grip" size={15}/></span>
                      <button type="button" className="subedit__check" data-done={s.done?'true':'false'} aria-label={(s.done?'Uncheck subtask: ':'Complete subtask: ')+s.name} onClick={()=>setSubtasks(arr=>toggleSubAndSink(arr,s.id))}><Icon name="check" size={11}/></button>
                      <input className="subedit__input" aria-label="Subtask name" value={s.name} onChange={(e)=>setSubtasks(arr=>arr.map(x=>x.id===s.id?{...x,name:e.target.value}:x))}/>
                      {steps.length>0&&<span className="subedit__rollup" aria-label={sd+' of '+steps.length+' steps done'} title="Steps done">{sd}/{steps.length}</span>}
                      {editing&&onPromote&&<button type="button" className="subedit__promote" aria-label="Promote to its own task" title="Promote to its own task" onClick={()=>promoteSub(s)}><Icon name="promote" size={14}/></button>}
                      <button type="button" className="subedit__del" aria-label={'Delete subtask: '+s.name} onClick={()=>setSubtasks(arr=>arr.filter(x=>x.id!==s.id))}><Icon name="x" size={14}/></button>
                    </div>
                    {(steps.length>0||stepFor===s.id||!atCap)&&(
                      <div className="steplist">
                        {steps.map(p=>(
                          <div className="steprow steprow--edit" key={p.id} data-done={p.done?'true':'false'}>
                            <button type="button" className="steprow__check" data-done={p.done?'true':'false'} aria-label={(p.done?'Uncheck step: ':'Complete step: ')+p.name} onClick={()=>toggleStep(s.id,p.id)}><Icon name="check" size={9}/></button>
                            <input className="steprow__input" aria-label="Step name" value={p.name} onChange={(e)=>renameStep(s.id,p.id,e.target.value)}/>
                            <button type="button" className="steprow__del" aria-label={'Delete step: '+p.name} onClick={()=>delStep(s.id,p.id)}><Icon name="x" size={12}/></button>
                          </div>
                        ))}
                        {stepFor===s.id&&!atCap&&(
                          <div className="steprow steprow--edit">
                            <span className="steprow__bullet" aria-hidden="true"/>
                            <input ref={stepInputRef} className="steprow__input" autoFocus aria-label="New step" placeholder="Step…" value={stepDraft}
                              onChange={(e)=>setStepDraft(e.target.value)}
                              onBlur={()=>{if(stepDraft.trim())addStep(s.id);setStepFor(null);setStepDraft('');}}
                              onKeyDown={(e)=>{
                                if(e.key==='Enter'){e.preventDefault();addStep(s.id);}
                                if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setStepDraft('');setStepFor(null);}
                              }}/>
                          </div>
                        )}
                        {atCap
                          ?<span className="stepcap">Maximum {MAX_STEPS} steps</span>
                          :stepFor!==s.id&&<button type="button" className="stepadd" onClick={()=>{setStepDraft('');setStepFor(s.id);}}><Icon name="plus" size={11}/>Step</button>}
                      </div>
                    )}
                  </div>);
                })}
              </div>
            )}
            <div className="subedit__add">
              <input ref={subInputRef} className="input" aria-label="New subtask" value={subDraft} placeholder={subtasks.length>=MAX_SUBS?'Maximum '+MAX_SUBS+' subtasks':'Add a subtask…'} disabled={subtasks.length>=MAX_SUBS} onChange={(e)=>setSubDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();addSub();}}}/>
              <button type="button" className="btn btn--ghost" onClick={addSub} disabled={!subDraft.trim()||subtasks.length>=MAX_SUBS}><Icon name="plus" size={15}/>Add</button>
            </div>
          </div>
          <div className="field">
            <span className="field__lbl">Weight</span>
            <div className="seg seg--weight">{WEIGHTS.map(w=><button key={w} className="seg__opt" data-on={weight===w?'true':'false'} style={{'--w':`var(--w-${w})`}} onClick={()=>setWeight(w)}><span className="seg__dot"/>{WEIGHT_LABELS[w]}</button>)}</div>
            <span className="field__hint">{WEIGHT_DESC[weight]}</span>
          </div>
          <div className="field-row">
            <div className="field" style={{position:'relative'}}>
              <span className="field__lbl">Date</span>
              <button type="button" className="pickbtn" aria-label={backlog?'Date: Backlog':'Date'} onClick={()=>{setShowCal(o=>!o);setShowStage(false);}}><Icon name={backlog?'package':'cal'} size={15}/><span>{backlog?'Backlog':new Date(date+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span><span className="pickbtn__chev"><Icon name="chevDown" size={15}/></span></button>
              {showCal&&(<>
                <div className="datepick__scrim" onMouseDown={(e)=>{e.stopPropagation();setShowCal(false);}}/>
                <div className="datepick__pop" onMouseDown={(e)=>e.stopPropagation()}>
                  <MiniCalendar focusDate={new Date(date+'T00:00:00')} setFocusDate={(d)=>{setDate(dayKey(d));setBacklog(false);setShowCal(false);}}/>
                  <button type="button" className="datepick__backlog" data-on={backlog?'true':'false'} onClick={()=>{setBacklog(b=>!b);setShowCal(false);}}>
                    <Icon name="package" size={14}/>{backlog?'Give it a date':'Move to Backlog'}
                  </button>
                </div>
              </>)}
            </div>
            <div className="field" style={{position:'relative'}}>
              <span className="field__lbl">Stage</span>
              <button type="button" className="pickbtn" onClick={()=>{setShowStage(o=>!o);setShowCal(false);}}><span className="pickbtn__dot"/><span>{STAGE_LABELS[stage]}</span><span className="pickbtn__chev"><Icon name="chevDown" size={15}/></span></button>
              {showStage&&(<>
                <div className="datepick__scrim" onMouseDown={(e)=>{e.stopPropagation();setShowStage(false);}}/>
                <div className="popmenu" style={{top:'100%',left:0,marginTop:6}} onMouseDown={(e)=>e.stopPropagation()}>
                  {STAGES.map(s=><button key={s} type="button" className="popmenu__item" data-on={stage===s?'true':'false'} onClick={()=>{setStage(s);setShowStage(false);}}>{stage===s&&<Icon name="check" size={14}/>}<span style={{marginLeft:stage===s?0:22}}>{STAGE_LABELS[s]}</span></button>)}
                </div>
              </>)}
            </div>
          </div>
          <div className="field">
            <span className="field__lbl">Tags</span>
            <div className="tagpick">
              {tags.map(t=>(
                <span className="tagchip-wrap" key={t}>
                  <button type="button" className="tagchip" data-confirm={confirmTagDel===t?'true':'false'} data-on={tag===t?'true':'false'} onClick={()=>{if(confirmTagDel===t){setTag(t);setConfirmTagDel(null);}else{setTag(tag===t?'':t);}}}>{confirmTagDel===t?'Delete?':t}</button>
                  {confirmTagDel===t
                    ?<button type="button" className="tagchip__x tagchip__x--confirm" title="Confirm delete" onClick={(e)=>{e.stopPropagation();dropTag(t);}}><Icon name="check" size={11}/></button>
                    :<button type="button" className="tagchip__x" title="Remove tag" onClick={(e)=>{e.stopPropagation();setConfirmTagDel(t);}}><Icon name="x" size={11}/></button>}
                </span>
              ))}
              {addingTag?<input className="input tagpick__input" value={tagDraft} autoFocus placeholder="New tag…" onChange={(e)=>setTagDraft(e.target.value)} onBlur={commitTag} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();commitTag();}if(e.key==='Escape'){setTagDraft('');setAddingTag(false);}}}/>:<button type="button" className="tagchip tagchip--add" onClick={()=>setAddingTag(true)}><Icon name="plus" size={13}/>Tag</button>}
            </div>
          </div>
          {showNotes?(
            <div className="field">
              <div className="tm-noteshead"><span className="field__lbl">Notes</span><button className="iconbtn" title="Hide notes" onClick={()=>setShowNotes(false)}><Icon name="x" size={14}/></button></div>
              <textarea className="input input--area" autoFocus rows={3} value={notes} placeholder="Add a description or reminder…" onChange={(e)=>setNotes(e.target.value)}/>
            </div>
          ):(
            <button type="button" className="ghostadd" onClick={()=>setShowNotes(true)}><Icon name="plus" size={14}/>Add notes</button>
          )}
        </div>
        {confirmDel?(
          <div className="modal__foot-confirm"><div className="modal__foot-confirm__msg"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Delete this task?</div><div className="modal__foot-confirm__btns"><button className="btn btn--ghost" style={{flex:1}} onClick={()=>setConfirmDel(false)}>Cancel</button><button className="btn btn--ghost btn--danger" style={{flex:1}} onClick={()=>onDelete&&onDelete(initial.id)}><Icon name="trash" size={14}/>Yes, delete</button></div></div>
        ):(
          <div className="modal__foot">
            {editing?(
              <div style={{position:'relative'}}>
                <button className="iconbtn iconbtn--bordered" title="More actions" onClick={()=>setShowMore(o=>!o)}><Icon name="dots" size={18}/></button>
                {showMore&&(<>
                  <div className="datepick__scrim" onMouseDown={(e)=>{e.stopPropagation();setShowMore(false);}}/>
                  <div className="popmenu" style={{bottom:'100%',left:0,marginBottom:6}} onMouseDown={(e)=>e.stopPropagation()}>
                    <button type="button" className="popmenu__item" onClick={()=>{setShowMore(false);if(onSaveAsTemplate)onSaveAsTemplate({name,weight,stage,tag,notes:notes.trim(),subtasks});}}><Icon name="copy" size={15}/>Save as template</button>
                    <button type="button" className="popmenu__item popmenu__item--danger" onClick={()=>{setShowMore(false);setConfirmDel(true);}}><Icon name="trash" size={15}/>Delete task</button>
                  </div>
                </>)}
              </div>
            ):<span/>}
            <span className="modal__bar__spacer"/>
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn--primary" onClick={save} disabled={!name.trim()}>{editing?'Save':'Add task'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== TAG MANAGER =====
function TagManager({tags,onAdd,onRemove,onRename,onClose}){
  const [draft,setDraft]=useState('');
  const [confirmDel,setConfirmDel]=useState(null);
  function addNew(){const v=draft.trim();if(!v||tags.includes(v)){setDraft('');return;}onAdd(v);setDraft('');}
  return(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="modal__panel" role="dialog" aria-modal="true" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="modal__bar"><span className="modal__title">Tags</span><button className="iconbtn" onClick={onClose}><Icon name="x" size={18}/></button></div>
        <div className="modal__body">
          <div className="hmgr__list">
            {tags.length===0?<p className="hmgr__empty">No tags yet.</p>:tags.map(t=>(
              <div className="hmgr__row" key={t}>
                <span className="hmgr__tagdot"/>
                <input className="input hmgr__name" value={t} placeholder="Tag name" onChange={(e)=>onRename(t,e.target.value)}/>
                {confirmDel===t
                  ?(<div className="hmgr__delconfirm"><button type="button" className="btn btn--ghost btn--danger hmgr__delconfirm-yes" onClick={()=>{onRemove(t);setConfirmDel(null);}}>Delete</button><button type="button" className="btn btn--ghost hmgr__delconfirm-no" onClick={()=>setConfirmDel(null)}>Keep</button></div>)
                  :(<button type="button" className="hmgr__del" title="Delete tag" onClick={()=>setConfirmDel(t)}><Icon name="trash" size={15}/></button>)}
              </div>
            ))}
          </div>
          <div className="hmgr__new">
            <span className="setsec__lbl">Add a tag</span>
            <div className="hmgr__row">
              <span className="hmgr__tagdot"/>
              <input className="input hmgr__name" value={draft} placeholder="New tag name…" onChange={(e)=>setDraft(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')addNew();}}/>
              <button type="button" className="btn btn--primary" onClick={addNew} disabled={!draft.trim()}>Add</button>
            </div>
          </div>
        </div>
        <div className="modal__foot"><span/><button className="btn btn--primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// ===== TEMPLATES =====
function TemplatesPopover({templates,onUse,onDelete,onClose,onNew}){
  return(
    <div className="tplpop-overlay" onMouseDown={onClose}>
      <div className="tplpop" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="tplpop__bar">
          <span className="tplpop__title">Templates</span>
          {templates.length>0&&<span className="tplpop__cnt">{templates.length}</span>}
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={16}/></button>
        </div>
        <div className="tplpop__body">
          {templates.length===0?(
            <div className="tplpop__empty">No templates yet.<br/>Save any task as a template from the task editor.</div>
          ):templates.map(t=>(
            <div key={t.id} className="tplrow" onClick={()=>{onUse(t);onClose();}}>
              <div className="tplrow__icon"><Icon name={t.icon||'filetext'} size={16}/></div>
              <div className="tplrow__body">
                <div className="tplrow__name">{t.name}</div>
                <div className="tplrow__meta">
                  {t.includes&&t.includes.weight&&<span className="tplrow__metadot" style={{'--c':'var(--w-'+(t.weight||'none')+')'}}>{WEIGHT_LABELS[t.weight]||'None'}</span>}
                  {t.includes&&t.includes.subtasks&&t.subtasks&&t.subtasks.length>0&&<span>{t.subtasks.length} subtask{t.subtasks.length!==1?'s':''}</span>}
                  {t.includes&&t.includes.tag&&t.tag&&<span>{t.tag}</span>}
                </div>
              </div>
              <button className="tplrow__menu" onClick={(e)=>{e.stopPropagation();onDelete(t.id);}} title="Delete template">
                <Icon name="trash" size={14}/>
              </button>
            </div>
          ))}
          <button className="tplpop__add" onClick={onNew}><Icon name="plus" size={13}/>New blank template</button>
        </div>
      </div>
    </div>
  );
}

function SaveTemplateDialog({taskData,onSave,onClose}){
  const [name,setName]=useState(taskData&&taskData.name?taskData.name:'');
  const [icon,setIcon]=useState('filetext');
  const [inc,setInc]=useState({name:true,weight:true,tag:false,subtasks:!!(taskData&&taskData.subtasks&&taskData.subtasks.length),notes:false,location:false});
  function toggle(k){setInc(function(o){var n={};for(var x in o)n[x]=o[x];n[k]=!n[k];return n;});}
  function save(){
    if(!name.trim())return;
    var t={id:uid(),name:name.trim(),icon:icon,includes:{name:inc.name,weight:inc.weight,tag:inc.tag,subtasks:inc.subtasks,notes:inc.notes,location:inc.location}};
    if(inc.name)t.taskName=(taskData&&taskData.name)||'';
    if(inc.weight)t.weight=(taskData&&taskData.weight)||'light';
    if(inc.tag)t.tag=(taskData&&taskData.tag)||'';
    if(inc.subtasks)t.subtasks=((taskData&&taskData.subtasks)||[]).map(function(x){return{id:uid(),name:x.name,done:false};});
    if(inc.notes)t.notes=(taskData&&taskData.notes)||'';
    if(inc.location)t.location=(taskData&&taskData.location)||'';
    onSave(t);
  }
  var fields=[['name','Task name'],['weight','Weight'],['tag','Tag'],['subtasks','Subtasks'],['notes','Notes']];
  return(
    <div className="savetpl" onMouseDown={onClose}>
      <div className="savetpl__panel" onMouseDown={function(e){e.stopPropagation();}}>
        <div className="savetpl__bar"><span>Save as template</span><button className="iconbtn" onClick={onClose}><Icon name="x" size={18}/></button></div>
        <div className="savetpl__body">
          <div className="field"><span className="field__lbl">Template name</span><input className="input" value={name} autoFocus placeholder="e.g. Photoshoot w/ ___" onChange={function(e){setName(e.target.value);}}/></div>
          <div className="field"><span className="field__lbl">Icon</span>
            <div className="iconpick">
              {TPL_ICONS.map(function(ic){return(
                <button key={ic} type="button" className="iconpick__opt" data-on={icon===ic?'true':'false'} onClick={function(){setIcon(ic);}} title={ic}><Icon name={ic} size={15}/></button>
              );})}
            </div>
          </div>
          <div className="field"><span className="field__lbl">Include from this task</span>
            <div className="tpl__checks">
              {fields.map(function(f){return(
                <button key={f[0]} type="button" className="tpl__chk" data-on={inc[f[0]]?'true':'false'} onClick={function(){toggle(f[0]);}}>
                  <span className="tpl__chk__box">{inc[f[0]]&&<Icon name="check" size={10}/>}</span>
                  <span>{f[1]}</span>
                </button>
              );})}
            </div>
          </div>
        </div>
        <div className="savetpl__foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={!name.trim()}>Save template</button>
        </div>
      </div>
    </div>
  );
}

// ===== SETTINGS MODAL =====
function SetToggle({on,onChange}){return<button type="button" role="switch" aria-checked={on?'true':'false'} className="toggle" data-on={on?'true':'false'} onClick={()=>onChange(!on)}><span className="toggle__knob"/></button>;}
function InlineSeg({value,options,onChange}){return<div className="seg seg--inline">{options.map(o=><button key={o.v} type="button" className="seg__opt" data-on={value===o.v?'true':'false'} onClick={()=>onChange(o.v)}>{o.label}</button>)}</div>;}
function SetRow({icon,color,label,sub,control,chevron,danger,onClick}){
  const inner=(<React.Fragment><span className="setrow__ico" style={{'--c':color}}><Icon name={icon} size={15}/></span><span className="setrow__txt"><span className="setrow__label">{label}</span>{sub&&<span className="setrow__sub">{sub}</span>}</span>{control&&<span className="setrow__ctrl">{control}</span>}{chevron&&<span className="setrow__chev"><Icon name="chevron" size={16}/></span>}</React.Fragment>);
  return onClick?<button type="button" className={'setrow'+(danger?' setrow--danger':'')} onClick={onClick}>{inner}</button>:<div className={'setrow'+(danger?' setrow--danger':'')}>{inner}</div>;
}
function SetSection({label,children}){return<div className="setsec"><span className="setsec__lbl">{label}</span><div className="setgroup">{children}</div></div>;}

// ===== CROP MODAL =====
function CropModal({src,onConfirm,onCancel}){
  const [offset,setOffset]=React.useState({x:0,y:0});
  const [scale,setScale]=React.useState(1);
  const [imgNat,setImgNat]=React.useState({w:1,h:1});
  const stageRef=React.useRef(null);
  const dragRef=React.useRef(null);

  // On pointer down, start drag tracking
  function onPD(e){
    e.preventDefault();
    const start={px:e.clientX,py:e.clientY,ox:offset.x,oy:offset.y};
    dragRef.current=start;
    function onPM(ev){
      if(!dragRef.current)return;
      const dx=ev.clientX-dragRef.current.px;
      const dy=ev.clientY-dragRef.current.py;
      setOffset({x:dragRef.current.ox+dx,y:dragRef.current.oy+dy});
    }
    function onPU(){dragRef.current=null;window.removeEventListener('pointermove',onPM);window.removeEventListener('pointerup',onPU);}
    window.addEventListener('pointermove',onPM);
    window.addEventListener('pointerup',onPU);
  }

  // Extract circular crop as data URL
  function crop(){
    const stage=stageRef.current;if(!stage)return;
    const sz=stage.offsetWidth;
    const ringR=sz*0.75/2;
    const cx=sz/2;const cy=sz/2;
    // Image position and size in stage coordinates
    const nat=Math.max(imgNat.w,imgNat.h)||1;
    const base=Math.min(sz,nat);
    const rw=(imgNat.w/nat)*base*scale;
    const rh=(imgNat.h/nat)*base*scale;
    const ix=cx+offset.x-rw/2;  // image left edge in stage px
    const iy=cy+offset.y-rh/2;  // image top edge in stage px
    // Ring top-left in stage coordinates
    const rx=cx-ringR; const ry=cy-ringR;
    // Convert ring area to source image pixel coordinates
    const scaleX=imgNat.w/rw; const scaleY=imgNat.h/rh;
    const srcX=(rx-ix)*scaleX; const srcY=(ry-iy)*scaleY;
    const srcW=ringR*2*scaleX; const srcH=ringR*2*scaleY;
    // Draw to circular-clipped canvas
    const OUT=320;
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=OUT;
    const ctx=canvas.getContext('2d');
    ctx.beginPath();ctx.arc(OUT/2,OUT/2,OUT/2,0,Math.PI*2);ctx.clip();
    const img=new Image();
    img.onload=()=>{
      ctx.drawImage(img,srcX,srcY,srcW,srcH,0,0,OUT,OUT);
      onConfirm(canvas.toDataURL('image/jpeg',.92));
    };
    img.src=src;
  }

  const stageW=340;
  const ringR=stageW*0.75/2;
  const nat=Math.max(imgNat.w,imgNat.h)||1;
  const baseW=(imgNat.w/nat)*stageW;const baseH=(imgNat.h/nat)*stageW;
  const iw=baseW*scale;const ih=baseH*scale;

  return(
    <div className="crop-overlay" onMouseDown={onCancel}>
      <div className="crop-shell" onMouseDown={e=>e.stopPropagation()}>
        <div className="crop-shell__bar">
          <span className="crop-shell__title">Position photo</span>
          <button className="iconbtn" onClick={onCancel}><Icon name="x" size={18}/></button>
        </div>
        <div className="crop-stage" ref={stageRef} onPointerDown={onPD}>
          <img src={src} alt="" className="crop-stage__img" draggable="false"
            style={{width:iw,height:ih,left:'50%',top:'50%',transform:`translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`}}
            onLoad={e=>setImgNat({w:e.target.naturalWidth,h:e.target.naturalHeight})}
          />
          <div className="crop-stage__ring"/>
        </div>
        <div className="crop-zoom">
          <span className="crop-zoom__lbl">Zoom</span>
          <input type="range" min="0.5" max="3" step="0.05" value={scale} onChange={e=>setScale(Number(e.target.value))}/>
        </div>
        <div className="crop-shell__foot">
          <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn--primary" onClick={crop}>Use Photo</button>
        </div>
      </div>
    </div>
  );
}

// Copies the raw event log. No dashboard, no charts — the JSON is the product.
function CopyUsageLog(){
  const [state,setState]=useState('idle');
  async function copy(){
    const raw=(function(){try{return localStorage.getItem(EV_KEY)||'[]';}catch(_){return'[]';}})();
    try{
      await navigator.clipboard.writeText(raw);
      setState('done');
    }catch(_){
      try{
        const ta=document.createElement('textarea');
        ta.value=raw;ta.style.position='fixed';ta.style.opacity='0';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
        setState('done');
      }catch(__){setState('err');}
    }
    setTimeout(()=>setState('idle'),1800);
  }
  const n=readEvents().length;
  return(
    <SetRow icon="copy" color="var(--w-extra)" label="Copy usage log"
      sub={state==='done'?'Copied to clipboard':state==='err'?'Copy failed — try again':(n===0?'Nothing recorded yet':n+' event'+(n===1?'':'s')+' on this device')}
      control={<button type="button" className="btn btn--ghost" aria-label="Copy usage log to clipboard" onClick={copy}><Icon name={state==='done'?'check':'copy'} size={14}/>{state==='done'?'Copied':'Copy'}</button>}/>
  );
}
function SettingsModal({profile,userId,dark,setDark,view,setView,typeface,setTypeface,accent,setAccent,celebrate,setCelebrate,zoom,setZoom,subExpandDefault,setSubExpandDefault,rollover,setRollover,wipLimits,setWipLimits,templatesCount,onOpenTemplates,onSave,onPhotoSave,onClearTasks,clearScopeLabel,clearCount,onOpenArchive,archiveCount,onClose,onLogout}){
  // Appearance applies live for preview; Cancel restores what you walked in with.
  const initialLook=useRef({dark,typeface,accent,celebrate});
  function cancel(){const i=initialLook.current;setDark(i.dark);setTypeface(i.typeface);setAccent(i.accent);setCelebrate(i.celebrate);if(onClose)onClose();}
  const [confirmClear,setConfirmClear]=useState(false);
  const [tab,setTab]=useState('profile');
  const [first,setFirst]=useState(profile.first||'');const [last,setLast]=useState(profile.last||'');
  const [email,setEmail]=useState(profile.email||'');const [plan,setPlan]=useState(profile.plan||'Personal');
  const [photo,setPhoto]=useState(profile.photo||null);const [theme,setTheme]=useState(dark?'dark':'light');
  const [weekStart,setWeekStart]=useState('sun');
  const fileRef=useRef(null);const initials=((first[0]||'')+(last[0]||'')).toUpperCase()||'U';
  const [photoUploading,setPhotoUploading]=useState(false);
  const [cropSrc,setCropSrc]=useState(null); // image URL pending crop
  function pickPhoto(e){
    const file=e.target.files&&e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>setCropSrc(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value=''; // allow re-picking same file
  }
  async function uploadCropped(dataUrl){
    setCropSrc(null);
    if(SANDBOX){setPhoto(dataUrl);if(onPhotoSave)onPhotoSave(dataUrl);return;}
    setPhotoUploading(true);
    try{
      const res=await fetch(dataUrl);
      const blob=await res.blob();
      const path=`${userId}/${Date.now()}.jpg`;
      const{error}=await sb.storage.from('avatars').upload(path,blob,{upsert:true,contentType:'image/jpeg'});
      if(error){alert('Photo upload failed: '+error.message);setPhotoUploading(false);return;}
      const{data}=sb.storage.from('avatars').getPublicUrl(path);
      setPhoto(data.publicUrl);
      if(onPhotoSave)onPhotoSave(data.publicUrl);
    }catch(err){alert('Photo upload failed: '+err.message);}
    setPhotoUploading(false);
  }
  function pickTheme(v){setTheme(v);if(v==='light')setDark(false);else if(v==='dark')setDark(true);else setDark(!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));}
  function save(){if(onSave)onSave({first:first.trim()||'User',last:last.trim(),email:email.trim(),plan,photo});if(onClose)onClose();}
  return(
    <React.Fragment>
    {cropSrc&&<CropModal src={cropSrc} onConfirm={uploadCropped} onCancel={()=>setCropSrc(null)}/>}
    <div className="modal-scrim" onMouseDown={cancel}>
      <div className="modal__panel modal__panel--settings" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e)=>e.stopPropagation()}>
        <div className="modal__bar"><span className="modal__title">Settings</span><button className="iconbtn" aria-label="Close" onClick={cancel}><Icon name="x" size={18}/></button></div>
        <div className="settabs">
          <button type="button" className="settabs__opt" data-on={tab==='profile'?'true':'false'} onClick={()=>setTab('profile')}>Profile</button>
          <button type="button" className="settabs__opt" data-on={tab==='prefs'?'true':'false'} onClick={()=>setTab('prefs')}>Preferences</button>
        </div>
        {tab==='profile'?(
          <div className="modal__body">
            <div className="setavatar">
              <span className="setavatar__img">{photo?<img src={photo} alt=""/>:<span className="setavatar__initials">{initials}</span>}</span>
              <div className="setavatar__actions">
                <button type="button" className="btn btn--ghost" onClick={()=>!photoUploading&&fileRef.current&&fileRef.current.click()} disabled={photoUploading}><Icon name="camera" size={15}/>{photoUploading?'Uploading…':photo?'Change':'Upload photo'}</button>
                {photo&&<button type="button" className="btn btn--ghost btn--danger" onClick={()=>setPhoto(null)}>Remove</button>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto}/>
              </div>
            </div>
            <div className="field-row">
              <label className="field"><span className="field__lbl">First name</span><input className="input" value={first} placeholder="First" onChange={(e)=>setFirst(e.target.value)}/></label>
              <label className="field"><span className="field__lbl">Last name</span><input className="input" value={last} placeholder="Last" onChange={(e)=>setLast(e.target.value)}/></label>
            </div>
            <label className="field"><span className="field__lbl">Email</span><input className="input" type="email" value={email} placeholder="you@studio.com" onChange={(e)=>setEmail(e.target.value)}/></label>
            <SetSection label="Account">
              <SetRow icon="x" color="var(--danger)" label="Log out" danger chevron onClick={onLogout}/>
            </SetSection>
          </div>
        ):(
          <div className="modal__body">
            <div className="setsec">
              <span className="setsec__lbl">Appearance</span>
              <div className="field">
                <span className="field__lbl">Theme</span>
                <div className="seg">
                  <button type="button" className="seg__opt" data-on={theme==='light'?'true':'false'} onClick={()=>pickTheme('light')}><Icon name="sun" size={14}/>Light</button>
                  <button type="button" className="seg__opt" data-on={theme==='dark'?'true':'false'} onClick={()=>pickTheme('dark')}><Icon name="moon" size={14}/>Dark</button>
                  <button type="button" className="seg__opt" data-on={theme==='auto'?'true':'false'} onClick={()=>pickTheme('auto')}><Icon name="auto" size={14}/>Auto</button>
                </div>
              </div>
              <div className="field">
                <span className="field__lbl">Typeface</span>
                <div className="seg">{FONT_KEYS.map(k=><button key={k} type="button" className="seg__opt" data-on={typeface===k?'true':'false'} style={{fontFamily:FONT_SETS[k].ui}} onClick={()=>setTypeface(k)}>{k}</button>)}</div>
              </div>
              <div className="field">
                <span className="field__lbl">Color scheme</span>
                <div className="swatchrow">{ACCENT_KEYS.map(k=><button key={k} type="button" className="swatch" data-on={accent===k?'true':'false'} style={{'--sw':ACCENTS[k].swatch}} onClick={()=>setAccent(k)}><span className="swatch__dot"/><span>{k}</span></button>)}</div>
              </div>
              <div className="field">
                <span className="field__lbl">Celebrations</span>
                <div className="seg">
                  {[['full','Full'],['subtle','Subtle'],['off','Off']].map(([v,l])=><button key={v} type="button" className="seg__opt" data-on={celebrate===v?'true':'false'} onClick={()=>setCelebrate(v)}>{l}</button>)}
                </div>
                <span className="field__hint">{celebrate==='full'?'Confetti, glow and a day-complete moment.':celebrate==='subtle'?'Soft glow only — no confetti or vibration.':'No completion effects.'}</span>
              </div>
            </div>
            <SetSection label="App behavior">
              <SetRow icon="layout" color="var(--w-extra)" label="Default view" control={<InlineSeg value={view} onChange={setView} options={[{v:'kanban',label:'Kanban'},{v:'weight',label:'Weight'}]}/>}/>
              <SetRow icon="subtasks" color="var(--w-medium)" label="Subtasks open expanded" sub="Show subtasks without tapping" control={<SetToggle on={subExpandDefault} onChange={setSubExpandDefault}/>}/>
              <SetRow icon="plus" color="var(--accent)" label="Board zoom" control={
                <div className="zoom-inline">
                  <button type="button" disabled={zoom<=0.8} onClick={()=>setZoom(z=>Math.max(0.8,Math.round((z-0.1)*10)/10))}>−</button>
                  <span className="zoom-inline__val" onClick={()=>setZoom(1)} title="Reset">{Math.round((zoom||1)*100)}%</span>
                  <button type="button" disabled={zoom>=1.6} onClick={()=>setZoom(z=>Math.min(1.6,Math.round((z+0.1)*10)/10))}>+</button>
                </div>
              }/>
              <SetRow icon="filetext" color="var(--w-medium)" label="Templates" sub={templatesCount>0?templatesCount+' saved':'No templates yet'} chevron onClick={onOpenTemplates}/>
            </SetSection>
            <SetSection label="Work in progress limits">
              {[['todo','To Do'],['doing','In Progress']].map(([k,lbl])=>(
                <SetRow key={k} icon={STAGE_ICONS[k]} color={k==='todo'?'var(--w-light)':'var(--accent)'} label={lbl+' limit'}
                  sub={((wipLimits||WIP_DEFAULT)[k]||0)===0?'Off — no cap on this column':'Asks what comes out once you hit '+(wipLimits||WIP_DEFAULT)[k]}
                  control={
                    <div className="zoom-inline">
                      <button type="button" aria-label={'Decrease '+lbl+' limit'} disabled={((wipLimits||WIP_DEFAULT)[k]||0)<=0} onClick={()=>setWipLimits(w=>normWip({...(w||WIP_DEFAULT),[k]:((w||WIP_DEFAULT)[k]||0)-1}))}>−</button>
                      <span className="zoom-inline__val" aria-live="polite">{((wipLimits||WIP_DEFAULT)[k]||0)===0?'Off':(wipLimits||WIP_DEFAULT)[k]}</span>
                      <button type="button" aria-label={'Increase '+lbl+' limit'} disabled={((wipLimits||WIP_DEFAULT)[k]||0)>=20} onClick={()=>setWipLimits(w=>normWip({...(w||WIP_DEFAULT),[k]:((w||WIP_DEFAULT)[k]||0)+1}))}>+</button>
                    </div>
                  }/>
              ))}
            </SetSection>
            <SetSection label="Daily rollover">
              <div className="rollopts">
                {ROLLOVER_MODES.map(o=>(
                  <React.Fragment key={o.v}>
                    <button type="button" className="rollopt" data-on={(rollover.mode||'newday')===o.v?'true':'false'} onClick={()=>setRollover(r=>({...r,mode:o.v}))}>
                      <span className="rollopt__radio"/>
                      <span className="rollopt__txt"><span className="rollopt__label">{o.label}</span><span className="rollopt__sub">{o.desc}</span></span>
                    </button>
                    {o.v==='scheduled'&&rollover.mode==='scheduled'&&(
                      <div className="rollopt__time"><span className="field__lbl">Remind me at</span><input type="time" className="input input--time" value={rollover.time||'18:00'} onChange={(e)=>setRollover(r=>({...r,time:e.target.value}))}/></div>
                    )}
                  </React.Fragment>
                ))}
              </div>
              <div className="setgroup" style={{marginTop:8}}>
                <SetRow icon="repeat" color="var(--accent)" label="Move automatically" sub="Skip the prompt — move silently with undo" control={<SetToggle on={!!rollover.auto} onChange={(v)=>setRollover(r=>({...r,auto:v}))}/>}/>
              </div>
            </SetSection>
            <SetSection label="Data &amp; privacy">
              <SetRow icon="archive" color="var(--w-light)" label="Archive" sub={archiveCount>0?archiveCount+(archiveCount===1?' archived item':' archived items'):'Recover deleted tasks & habits'} chevron onClick={()=>onOpenArchive&&onOpenArchive()}/>
              <CopyUsageLog/>
              <SetRow icon="trash" color="var(--w-heavy)" label="Delete tasks for this day" sub={clearScopeLabel||'Clears the selected day only'} danger chevron onClick={()=>setConfirmClear(true)}/>
              {confirmClear&&(
                <div className="setconfirm-box">
                  <p className="setconfirm-box__msg">{clearCount>0?('Delete '+clearCount+(clearCount===1?' task':' tasks')+' for '+(clearScopeLabel||'this day')+'? Only this day is affected, and you can restore them anytime from Archive.'):('No tasks to delete for '+(clearScopeLabel||'this day')+'.')}</p>
                  <div className="setconfirm-box__btns">
                    <button type="button" className="btn btn--ghost" onClick={()=>setConfirmClear(false)}>Cancel</button>
                    <button type="button" className="btn btn--ghost btn--danger" disabled={!clearCount} onClick={()=>{onClearTasks&&onClearTasks();setConfirmClear(false);}}><Icon name="trash" size={14}/>Delete</button>
                  </div>
                </div>
              )}
            </SetSection>
          </div>
        )}
        <div className="modal__foot"><span className="settings__version">Heft v{HEFT_VERSION}</span><div className="modal__actions"><button className="btn btn--ghost" onClick={cancel}>Cancel</button><button className="btn btn--primary" onClick={save}>Save</button></div></div>
      </div>
    </div>
    </React.Fragment>
  );
}

// ===== INITIAL DATA =====
const HEFT_VERSION='0.25.1';
const TPL_ICONS=['camera','star','briefcase','users','cal','mappin','mail','package','globe','palette','music','coffee','zap','heart','filetext','repeat'];
function todayKeyNow(){const n=new Date();return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');}

// No demo tasks — app starts clean. All data comes from what the user creates.
const INITIAL_TASKS=[];
const INITIAL_HABITS=[];
function makeInitialLog(){return {};}

// Legacy demo task IDs from earlier builds — filtered out on every load
// so they never reappear even if previously saved to localStorage or Supabase.
const LEGACY_DEMO_IDS=new Set(['t1','t2','t3','t4','t5','t6','t7','t8']);
function stripDemoTasks(tasks){return(tasks||[]).filter(t=>!LEGACY_DEMO_IDS.has(t.id));}
const INITIAL_TAGS=[];

// ===== DAILY ROLLOVER =====
const ROLLOVER_MODES=[
  {v:'manual',label:'Manual only',desc:'Move from the day ⋯ menu. Never prompt.'},
  {v:'newday',label:'On a new day',desc:'When a past day still has unfinished tasks, offer to move them forward.'},
  {v:'scheduled',label:'At a set time',desc:'Remind me at a chosen time while the app is open.'},
  {v:'always',label:'Whenever open',desc:'Show the prompt anytime the open day has unfinished tasks.'},
];
const ROLLOVER_DEFAULT={mode:'newday',time:'18:00',auto:false};
function nowPastTime(hhmm){if(!hhmm)return false;const parts=hhmm.split(':');const h=+parts[0],m=+parts[1];const n=new Date();return n.getHours()>h||(n.getHours()===h&&n.getMinutes()>=m);}

// ===== DAY PROGRESS RING =====
// Small always-visible progress ring for the focused day. Progress feedback is
// the core loop: seeing the ring close is what makes the next check-off pull.
function DayProgress({done,total}){
  if(total===0)return null;
  const R=9,C=2*Math.PI*R;
  const pct=done/total;
  const complete=done===total;
  return(
    <span className="dayring" data-complete={complete?'true':'false'} title={done+' of '+total+' done'}>
      <svg width="26" height="26" viewBox="0 0 26 26">
        <circle cx="13" cy="13" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="3"/>
        <circle cx="13" cy="13" r={R} fill="none" stroke={complete?'var(--w-light)':'var(--accent)'} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C*(1-pct)}
          transform="rotate(-90 13 13)" style={{transition:'stroke-dashoffset .6s cubic-bezier(.22,1,.36,1), stroke .3s'}}/>
      </svg>
      <span className="dayring__lbl">{complete?'✓':done+'/'+total}</span>
    </span>
  );
}

// ===== ONBOARDING =====
// First-run guided flow: welcome → create a real first task → add a habit → done.
// Only shows when there is no data at all; existing users never see it.
function Onboarding({firstName,onCreateTask,onCreateHabit,onFinish}){
  const [step,setStep]=useState(0);
  const [taskName,setTaskName]=useState('');
  const [taskWeight,setTaskWeight]=useState('medium');
  const [habitName,setHabitName]=useState('');
  const [habitIcon,setHabitIcon]=useState(HABIT_ICONS[0]);
  const [madeTask,setMadeTask]=useState(false);
  const [madeHabit,setMadeHabit]=useState(false);
  const total=4;
  function nextFromTask(){
    const v=taskName.trim();
    if(v){onCreateTask({name:v,weight:taskWeight});setMadeTask(true);}
    setStep(2);
  }
  function nextFromHabit(){
    const v=habitName.trim();
    if(v){onCreateHabit({name:v,icon:habitIcon});setMadeHabit(true);}
    setStep(3);
  }
  function finish(){
    onFinish();
    setTimeout(()=>fireConfetti(window.innerWidth/2,window.innerHeight*0.4,1.6),120);
  }
  function skipAll(){onFinish();} // skipping is fine — but it earns no confetti
  return(
    <div className="onboard-scrim">
      <div className="onboard" role="dialog" aria-modal="true" aria-label="Welcome to Heft">
        <div className="onboard__dots" aria-hidden="true">{Array.from({length:total},(_,i)=><span key={i} className="onboard__dot" data-on={i<=step?'true':'false'}/>)}</div>
        {step===0&&(
          <div className="onboard__step">
            <div className="onboard__mark"><HeftMark size={48}/></div>
            <h2 className="onboard__title">{firstName?('Welcome, '+firstName+'.'):'Welcome to Heft.'}</h2>
            <p className="onboard__sub">Heft weighs your day so you carry it lightly. Tasks get a <strong>weight</strong> — Light, Medium, Heavy, or Extra — so you can see what a day really costs before it starts.</p>
            <div className="onboard__actions">
              <button className="btn btn--primary onboard__cta" onClick={()=>setStep(1)}>Set up my day<Icon name="arrowright" size={15}/></button>
              <button className="onboard__skip" onClick={skipAll}>Skip for now</button>
            </div>
          </div>
        )}
        {step===1&&(
          <div className="onboard__step">
            <h2 className="onboard__title">What's one thing on your plate?</h2>
            <p className="onboard__sub">Add your first task. Don't overthink it — the one that's been nagging you works best.</p>
            <input className="input onboard__input" autoFocus value={taskName} placeholder="e.g. Send the invoice to Alex" onChange={(e)=>setTaskName(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&taskName.trim())nextFromTask();}}/>
            <div className="onboard__weights">
              <span className="field__lbl">How heavy does it feel?</span>
              <div className="seg seg--weight">{WEIGHTS.map(w=><button key={w} className="seg__opt" data-on={taskWeight===w?'true':'false'} style={{'--w':`var(--w-${w})`}} onClick={()=>setTaskWeight(w)}><span className="seg__dot"/>{WEIGHT_LABELS[w]}</button>)}</div>
              <span className="field__hint">{WEIGHT_DESC[taskWeight]}</span>
            </div>
            <div className="onboard__actions">
              <button className="btn btn--primary onboard__cta" onClick={nextFromTask} disabled={!taskName.trim()}>Add it<Icon name="arrowright" size={15}/></button>
              <button className="onboard__skip" onClick={()=>setStep(2)}>Skip this</button>
            </div>
          </div>
        )}
        {step===2&&(
          <div className="onboard__step">
            <h2 className="onboard__title">One small daily habit?</h2>
            <p className="onboard__sub">Habits live beside your tasks. Start daily — you can switch any habit to weekly or monthly later.</p>
            <div className="onboard__habitrow">
              <span className="hmgr__ico" style={{cursor:'default'}}><HabitIcon icon={habitIcon} size={16}/></span>
              <input className="input onboard__input" autoFocus value={habitName} placeholder="e.g. Read 10 pages" onChange={(e)=>setHabitName(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter'&&habitName.trim())nextFromHabit();}} style={{margin:0}}/>
            </div>
            <div className="habitnew__icons" style={{marginTop:4}}>
              {HABIT_ICONS.map(ic=><button key={ic} type="button" className="habitnew__ico" data-on={habitIcon===ic?'true':'false'} aria-label={ic} onClick={()=>setHabitIcon(ic)}><Icon name={ic} size={14}/></button>)}
            </div>
            <div className="onboard__actions">
              <button className="btn btn--primary onboard__cta" onClick={nextFromHabit} disabled={!habitName.trim()}>Add habit<Icon name="arrowright" size={15}/></button>
              <button className="onboard__skip" onClick={()=>setStep(3)}>Skip this</button>
            </div>
          </div>
        )}
        {step===3&&(
          <div className="onboard__step">
            <div className="onboard__mark"><Icon name="checkcircle" size={44}/></div>
            <h2 className="onboard__title">You're set.</h2>
            <p className="onboard__sub">
              {madeTask?'Your first task is on the board. ':'The board is ready when you are. '}
              {madeHabit?'Your habit lives in the side panel. ':''}
              Tap a task's circle once for <strong>in progress</strong>, twice to <strong>complete</strong> it — unfinished tasks can be carried to tomorrow with one tap.
            </p>
            <div className="onboard__actions">
              <button className="btn btn--primary onboard__cta" onClick={finish}>Start my day<Icon name="arrowright" size={15}/></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== ROOT APP =====
function loadLocal(){try{return JSON.parse(localStorage.getItem(LS_KEY)||'null');}catch{return null;}}
// Content identity of a state blob, ignoring the volatile save timestamp.
// Lets every push/apply path answer "did anything actually change?" so no-op
// writes (which bump the cloud timestamp and invite devices to clobber each
// other) and no-op applies (which force full board re-renders) can be skipped.
// Canonical (deep key-sorted) serialization. Postgres jsonb does NOT preserve
// key order, so a plain JSON.stringify of pushed-then-pulled state never
// string-matches — comparisons must be order-insensitive or every round trip
// looks like a "change" and the app echo-loops pushes forever.
function stableStringify(v){
  if(v===undefined||typeof v==='function')return undefined;
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(x=>{const s=stableStringify(x);return s===undefined?'null':s;}).join(',')+']';
  const keys=Object.keys(v).sort();
  const parts=[];
  for(const k of keys){const s=stableStringify(v[k]);if(s!==undefined)parts.push(JSON.stringify(k)+':'+s);}
  return '{'+parts.join(',')+'}';
}
function coreJSON(b){if(!b||typeof b!=='object')return null;const{_savedAt,...rest}=b;try{return stableStringify(rest);}catch{return null;}}
// Persisted "last synced" mark (content hash + cloud time). Lets a fresh session
// tell a STALE LOCAL COPY of already-synced state (safe to replace with cloud)
// apart from GENUINE OFFLINE EDITS (safe to push up) — something timestamps
// alone can't do across devices.
const SYNC_KEY=SANDBOX?'heft.sandbox.sync.v1':'heft.sync.v1';
function coreHash(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return h>>>0;}
function readSyncMark(){try{const m=JSON.parse(localStorage.getItem(SYNC_KEY)||'null');return m&&typeof m.h==='number'?m:null;}catch{return null;}}
function writeSyncMark(core,tsMs){try{if(core!==null)localStorage.setItem(SYNC_KEY,JSON.stringify({h:coreHash(core),t:tsMs}));}catch{}}

function App({session}){
  const local=useMemo(loadLocal,[]);
  const [dark,setDark]=useState(local?.dark??false);
  const [view,setView]=useState(local?.view||'kanban');
  // Subtask default expand preference — per device. Default: expanded (true).
  const [subExpandDefault,setSubExpandDefault]=useState(()=>{const v=localStorage.getItem('heft.subExpand');return v===null?true:v==='true';});
  useEffect(()=>{localStorage.setItem('heft.subExpand',String(subExpandDefault));},[subExpandDefault]);
  const [tasks,setTasks]=useState(stripDemoTasks(local?.tasks)); // never seed demo tasks
  const [habits,setHabits]=useState(local?.habits||INITIAL_HABITS);
  const [habitLog,setHabitLog]=useState(local?.habitLog||makeInitialLog());
  const [habitArchive,setHabitArchive]=useState(local?.habitArchive||[]); // deleted habits, recoverable from Settings → Habit archive
  const [taskArchive,setTaskArchive]=useState(local?.taskArchive||[]); // deleted tasks (single + day-bulk), recoverable from the same archive
  const [tags,setTags]=useState(local?.tags||INITIAL_TAGS);
  const [focusDate,setFocusDateRaw]=useState(todayDate);
  // Page-turn direction for day navigation. Captured per instance so the
  // board wrapper can slide in from the side the user is heading toward.
  const dayNavDir=useRef(0);
  const focusDateRef=useRef(null);
  const setFocusDate=useCallback((d)=>{
    const prev=focusDateRef.current;
    if(prev instanceof Date&&d instanceof Date){dayNavDir.current=d>prev?1:(d<prev?-1:0);}
    setFocusDateRaw(d);
  },[]);
  const [sidebarOpen,setSidebarOpen]=useState(()=>window.innerWidth>=768); // closed by default on mobile
  const [activeWeights,setActiveWeights]=useState([]);
  const [activeTag,setActiveTag]=useState(null);
  const [query,setQuery]=useState('');
  const [profile,setProfile]=useState(local?.profile||(function(){const u=session&&session.user;const md=(u&&u.user_metadata)||{};return{first:md.first_name||'',last:md.last_name||'',email:(u&&u.email)||'',plan:'Personal',photo:null};})());
  const [typeface,setTypeface]=useState(FONT_SETS[local?.typeface]?local.typeface:'Minimal');
  const [accent,setAccent]=useState(ACCENTS[local?.accent]?local.accent:'Clay');
  const [celebrate,setCelebrate]=useState(local?.celebrate||'full');
  useEffect(()=>{CELEBRATE=celebrate;},[celebrate]);
  // One Escape closes whatever is on top — modals, menus, dialogs.
  useEffect(()=>{
    function onKey(e){
      if(e.key!=='Escape')return;
      setModal(m=>m?null:m);setCarryOpen(false);setShowTemplates(false);setSavingTemplate(v=>v?null:v);setSwap(null);
    }
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[]);
  const [modal,setModal]=useState(null); // {type:'task'|'settings'|'habits'|'tags', data?:...}
  const [toast,setToast]=useState(null);
  const toastTimer=useRef(null);
  const saveTimer=useRef(null);
  const lastSaveAt=useRef((local&&local._savedAt)||0); // local save timestamp — protects local data from being wiped by older cloud state
  const lastCloudTsRef=useRef(null); // cloud updated_at we last saw — detects real remote changes without cross-device clock math
  // Core JSON of the state last pushed to / applied from cloud — the "nothing
  // new here" check. Seeded from the persisted sync mark: if local state still
  // hashes to what was last synced, this device has nothing novel and any
  // cloud change may be applied regardless of timestamp/clock skew.
  const[initialSyncedCore]=useState(()=>{const mark=readSyncMark();const lc=coreJSON(local);return(mark&&lc!==null&&coreHash(lc)===mark.h)?lc:null;});
  const lastSyncedJSONRef=useRef(initialSyncedCore);
  const pullBusyRef=useRef(0); // timestamp of in-flight pull — collapses overlapping pulls (focus + visibilitychange + poll can stack on wake)

  const [zoom,setZoom]=useState(()=>{const z=parseFloat(localStorage.getItem('heft.zoom'));return z>=0.8&&z<=1.6?z:1;}); // per-device, never synced
  const [sidebarWidth,setSidebarWidth]=useState(()=>Math.max(200,(local&&local.sidebarWidth)||208));
  useEffect(()=>{localStorage.setItem('heft.zoom',String(zoom));},[zoom]); // zoom stays local to this device
  const [sort,setSort]=useState(()=>(local&&local.sort)||'created');
  const [rollover,setRollover]=useState(()=>({...ROLLOVER_DEFAULT,...((local&&local.rollover)||{})}));
  const [wipLimits,setWipLimits]=useState(()=>normWip(local&&local.wipLimits)); // 0 on either lane = off
  const [swap,setSwap]=useState(null); // {stage,limit,count,apply} — the "what comes out?" sheet
  const [bannerDismissed,setBannerDismissed]=useState({});
  const [rollTick,setRollTick]=useState(0);
  const [carryOpen,setCarryOpen]=useState(false); // carry-over confirm dialog
  const [templates,setTemplates]=useState(()=>(local&&local.templates)||[]);
  const [showTemplates,setShowTemplates]=useState(false);
  const [savingTemplate,setSavingTemplate]=useState(null);
  const [resizing,setResizing]=useState(false);
  const [loaded,setLoaded]=useState(false);
  // First-run onboarding — only when the account has no data at all.
  const [showOnboard,setShowOnboard]=useState(false);
  const onboardChecked=useRef(false);
  const [syncing,setSyncing]=useState(false);
  const [saveError,setSaveError]=useState(false);
  const [lastSyncedAt,setLastSyncedAt]=useState(0); // ms timestamp of last successful sync (pull OR save)
  // Transient bottom-center pill. {state:'syncing'|'ok'|'error'} or null when hidden.
  // Only shown on real events (task moved/saved, or manual refresh) — never on idle polls.
  const [syncPill,setSyncPill]=useState(null);
  const pillTimer=useRef(null);
  const flashPillRef=useRef(null);
  if(!flashPillRef.current){
    flashPillRef.current=function(state){
      setSyncPill({state});
      if(pillTimer.current)clearTimeout(pillTimer.current);
      if(state!=='syncing')pillTimer.current=setTimeout(function(){setSyncPill(null);},2000);
    };
  }
  const flashPill=flashPillRef.current;
  // Offline awareness — reassures the user their edits are saved locally and will
  // sync when the connection returns. Persistent (not auto-dismissed) while offline.
  const [offline,setOffline]=useState(()=>typeof navigator!=='undefined'&&navigator.onLine===false);
  useEffect(()=>{
    function goOffline(){setOffline(true);}
    function goOnline(){setOffline(false);}
    window.addEventListener('offline',goOffline);
    window.addEventListener('online',goOnline);
    return()=>{window.removeEventListener('offline',goOffline);window.removeEventListener('online',goOnline);};
  },[]);

  function applyCloud(s){
    if(s.tasks)setTasks(stripDemoTasks(s.tasks.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)));
    if(s.habits)setHabits(s.habits);
    if(s.habitLog)setHabitLog(s.habitLog);
    if(s.habitArchive)setHabitArchive(s.habitArchive);
    if(s.taskArchive)setTaskArchive(s.taskArchive);
    if(s.tags)setTags(s.tags);
    if(s.profile)setProfile(p=>({...s.profile,photo:s.profile.photo??p.photo}));
    if(typeof s.dark==='boolean')setDark(s.dark);
    if(s.celebrate)setCelebrate(s.celebrate);
    if(s.view)setView(s.view);
    if(s.typeface)setTypeface(FONT_SETS[s.typeface]?s.typeface:'Minimal');
    if(s.accent)setAccent(s.accent);
    if(s.sidebarWidth)setSidebarWidth(s.sidebarWidth);
    if(s.sort)setSort(s.sort);
    if(s.rollover)setRollover({...ROLLOVER_DEFAULT,...s.rollover});
    if(s.wipLimits)setWipLimits(normWip(s.wipLimits));
    if(s.templates)setTemplates(s.templates);
  }

  // Pull from cloud. force=true always applies cloud; otherwise only if cloud is NEWER.
  // silent=true (auto-polls) avoids touching visible sync UI so it doesn't flicker.
  async function pullCloud(force,silent){
    if(SANDBOX){setLoaded(true);if(!silent)setSyncing(false);return;}
    // A drag in progress owns the board — applying remote state mid-drag yanks
    // cards out from under the pointer. The next poll (≤5s) picks the change up.
    if(silent&&document.body.classList.contains('heft-dragging'))return;
    // Collapse overlapping pulls, but never let a hung fetch (flaky network,
    // no rejection) lock sync out forever — the guard expires after 15s.
    if(pullBusyRef.current&&Date.now()-pullBusyRef.current<15000){if(!silent)setSyncing(false);return;}
    pullBusyRef.current=Date.now();
    if(!silent)setSyncing(true);
    try{
      const{data,error}=await sb.from('heft_state').select('data,updated_at').eq('user_id',session.user.id).maybeSingle();
      if(error)throw error;
      if(data&&data.data){
        const firstLook=lastCloudTsRef.current===null;
        const cloudTs=data.updated_at||'';
        const changed=cloudTs!==lastCloudTsRef.current;
        const localAt=lastSaveAt.current;
        const cloudAt=data.updated_at?new Date(data.updated_at).getTime():0;
        // Safe to apply remote state when nothing novel exists locally. Once this
        // session has synced at least once (lastSyncedJSONRef set) and isn't
        // dirty, local state is fully represented in the cloud, so clock skew
        // between devices can never cause a wrong refusal. On the very first
        // look of a session we fall back to the timestamp guard so offline
        // edits from a previous session are never wiped by older cloud data.
        const safe=!dirtyRef.current&&(lastSyncedJSONRef.current!==null||cloudAt>=localAt);
        if(force||(changed&&safe)){
          const incoming=coreJSON(data.data);
          // Identical content → skip the re-render entirely (no board churn,
          // no FLIP re-run, no spurious dirty/echo cycle).
          if(force||incoming!==lastSyncedJSONRef.current){
            applyCloud(data.data);
            lastSyncedJSONRef.current=incoming;
          }
          writeSyncMark(incoming,cloudAt);
          lastCloudTsRef.current=cloudTs;
        } else if(!changed){
          lastCloudTsRef.current=cloudTs;
        } else if(firstLook&&!dirtyRef.current&&cloudAt<localAt&&local){
          // Cloud is older than our last local save (edits made offline, or the
          // final save of the last session never reached Supabase). Push local
          // state up now instead of leaving it stranded until the next edit.
          const raw=localStorage.getItem(LS_KEY);
          if(raw){
            const now=Date.now();lastSaveAt.current=now;
            const ts=new Date(now).toISOString();
            let blob=null;try{blob=JSON.parse(raw);}catch(_){}
            if(blob){
              blob._savedAt=now;
              const{error:e2}=await sb.from('heft_state').upsert({user_id:session.user.id,data:blob,updated_at:ts},{onConflict:'user_id'});
              if(!e2){const c2=coreJSON(blob);lastSyncedJSONRef.current=c2;writeSyncMark(c2,now);setLastSyncedAt(Date.now());}
            }
          }
        }
      } else {
        if(!local) setTasks([]);
      }
      setSaveError(false);
    }catch(e){
      setSaveError(true);
      console.warn('[Heft] pullCloud failed:',e);
    }
    pullBusyRef.current=0;
    setLoaded(true);
    if(!silent)setSyncing(false);
  }
  useEffect(()=>{pullCloud(false);},[]);

  // Manual sync: save current state FIRST, then pull.
  // Prevents the refresh button from overwriting locally-added tasks
  // that haven't been saved yet (debounce may not have fired).
  async function manualSync(){
    if(syncing)return;
    if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
    setSyncing(true);flashPill('syncing');
    const now=Date.now();lastSaveAt.current=now;
    const ts=new Date(now).toISOString();
    const blob={tasks,habits,habitLog,habitArchive,taskArchive,tags,profile,dark,celebrate,view,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits,_savedAt:now};
    localStorage.setItem(LS_KEY,JSON.stringify(blob));
    if(SANDBOX){setSyncing(false);flashPill('ok');return;}
    // Only push when something genuinely changed on THIS device. A refresh on
    // a stale device must fetch the newer cloud state, not overwrite it.
    const core=coreJSON(blob);
    if(dirtyRef.current||(lastSyncedJSONRef.current!==null&&core!==lastSyncedJSONRef.current)){
      const{error}=await sb.from('heft_state').upsert({user_id:session.user.id,data:blob,updated_at:ts},{onConflict:'user_id'});
      if(error){setSaveError(true);flashPill('error');setSyncing(false);console.warn('[Heft] manualSync save failed:',error);return;}
      lastSyncedJSONRef.current=core;writeSyncMark(core,now);
      setSaveError(false);dirtyRef.current=false;setLastSyncedAt(Date.now());
    }
    await pullCloud(false);
    flashPill('ok');
  }

  // Flush save when tab/app goes to background — ensures Supabase has latest
  // data before the user switches to another device or the dock app.
  useEffect(()=>{
    function flushNow(){
      if(!loaded)return;
      // Cancel debounce and save RIGHT NOW
      if(saveTimer.current){clearTimeout(saveTimer.current);saveTimer.current=null;}
      const now=Date.now();lastSaveAt.current=now;
      const ts=new Date(now).toISOString();
      const blob={tasks,habits,habitLog,habitArchive,taskArchive,tags,profile,dark,celebrate,view,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits,_savedAt:now};
      localStorage.setItem(LS_KEY,JSON.stringify(blob));
      if(SANDBOX)return;
      // CRITICAL: never push unless this device actually changed something.
      // The old unconditional flush let a stale device (e.g. a Mac waking from
      // suspend mid-pull, then re-hiding) overwrite newer changes from another
      // device with old data at a fresh timestamp — the "my phone's check-offs
      // revert" bug.
      if(!dirtyRef.current)return;
      const core=coreJSON(blob);
      if(core===lastSyncedJSONRef.current){dirtyRef.current=false;return;} // only a cloud echo — nothing new to say
      sb.from('heft_state').upsert({user_id:session.user.id,data:blob,updated_at:ts},{onConflict:'user_id'}).then(({error})=>{
        if(error){setSaveError(true);console.warn('[Heft] background save failed:',error);}
        else{setSaveError(false);dirtyRef.current=false;lastSyncedJSONRef.current=core;writeSyncMark(core,now);setLastSyncedAt(Date.now());}
      });
    }
    function onVis(){
      if(document.visibilityState==='hidden'){flushNow();}
      else if(document.visibilityState==='visible'){
        // Pull latest when coming back to foreground (silent)
        pullCloud(false,true);
      }
    }
    document.addEventListener('visibilitychange',onVis);
    window.addEventListener('pagehide',flushNow); // iOS Safari can suspend a PWA without ever firing visibilitychange
    return()=>{document.removeEventListener('visibilitychange',onVis);window.removeEventListener('pagehide',flushNow);};
  },[loaded,tasks,habits,habitLog,habitArchive,taskArchive,tags,profile,view,dark,celebrate,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits]);

  // Poll every 5s while in foreground — Notion-like sync responsiveness
  useEffect(()=>{
    const id=setInterval(()=>{
      if(document.visibilityState==='visible')pullCloud(false,true);
    },5000);
    return()=>clearInterval(id);
  },[]);

  // Pull immediately on window focus (e.g., switching back from another app/tab)
  useEffect(()=>{
    function onFocus(){if(loaded)pullCloud(false,true);}
    window.addEventListener('focus',onFocus);
    return()=>window.removeEventListener('focus',onFocus);
  },[loaded]);

  // Mark local state as freshly-modified the INSTANT it changes (synchronous, pre-debounce).
  // Without this, a background poll firing in the 500ms debounce gap would see stale
  // lastSaveAt and overwrite a just-added task with older cloud data (the "disappears
  // on first add" bug). Bumping the ref here guarantees local always wins that race.
  const dirtyRef=useRef(false);
  useEffect(()=>{
    if(!loaded)return;
    lastSaveAt.current=Date.now();
    dirtyRef.current=true;
  },[tasks,habits,habitLog,habitArchive,taskArchive,tags,profile]);

  // Debounced save — only after initial load, so seed/filler can't overwrite real data
  useEffect(()=>{
    if(!loaded)return;
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      const now=Date.now();lastSaveAt.current=now;
      const ts=new Date(now).toISOString();
      const blob={tasks,habits,habitLog,habitArchive,taskArchive,tags,profile,dark,celebrate,view,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits,_savedAt:now};
      localStorage.setItem(LS_KEY,JSON.stringify(blob));
      const settlePill=()=>setSyncPill(pv=>{if(pv&&pv.state==='syncing'){if(pillTimer.current)clearTimeout(pillTimer.current);pillTimer.current=setTimeout(()=>setSyncPill(null),1600);return{state:'ok'};}return pv;});
      if(SANDBOX){setSaveError(false);dirtyRef.current=false;settlePill();return;}
      // Skip the upsert when content is identical to what's already synced —
      // typically this render was a cloud pull being applied. Prevents "echo"
      // pushes that bump the cloud timestamp on every device that pulls,
      // creating windows where devices overwrite each other's newer state.
      const core=coreJSON(blob);
      if(core===lastSyncedJSONRef.current){setSaveError(false);dirtyRef.current=false;settlePill();return;}
      const{error}=await sb.from('heft_state').upsert({user_id:session.user.id,data:blob,updated_at:ts},{onConflict:'user_id'});
      if(error){setSaveError(true);console.warn('[Heft] save failed:',error);}else{setSaveError(false);dirtyRef.current=false;lastSyncedJSONRef.current=core;writeSyncMark(core,now);setLastSyncedAt(Date.now());settlePill();}
    },500);
  },[loaded,tasks,habits,habitLog,habitArchive,taskArchive,tags,profile,view,dark,celebrate,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits]);

  async function logout(){if(SANDBOX){setModal(null);return;}await sb.auth.signOut();setModal(null);}

  const undoRef=useRef(null);
  const toastTimer2=useRef(null);
  const promoteRef=useRef(null); // snapshot for undoing a Promote
  const dayCompleteFor=useRef(null); // day-key the day-complete moment already fired for
  const cycleTickGuard=useRef(new Set()); // absorbs batched same-tick checkbox clicks
  function showToast(msg,action=null){
    if(toastTimer.current)clearTimeout(toastTimer.current);
    if(toastTimer2.current)clearTimeout(toastTimer2.current);
    setToast({msg,action});
    toastTimer.current=setTimeout(()=>{
      setToast(t=>t?{...t,leaving:true}:t);
      toastTimer2.current=setTimeout(()=>{setToast(null);undoRef.current=null;},230);
    },action?4500:2600);
  }
  function toggleWeight(w){setActiveWeights(cur=>cur.includes(w)?cur.filter(x=>x!==w):[...cur,w]);}
  function toggleHabit(hId,cadence,d){
    cadence=cadence==='weekly'||cadence==='monthly'?cadence:'daily';
    setHabitLog(log=>{
      const arr=log[hId]||[];
      if(cadence==='daily'){
        const k=dayKey(d);
        return{...log,[hId]:arr.includes(k)?arr.filter(x=>x!==k):[...arr,k]};
      }
      const keys=periodKeys(cadence,d);
      const done=keys.some(k=>arr.includes(k));
      if(done)return{...log,[hId]:arr.filter(k=>!keys.includes(k))};
      const today=dayKey(todayDate());
      const stamp=keys.includes(dayKey(d))&&dayKey(d)<=today?dayKey(d):(keys.filter(k=>k<=today).pop()||keys[0]);
      return{...log,[hId]:[...arr,stamp]};
    });
  }
  // Checkbox tap cycle. "completed" (the check) is decoupled from "stage" (the column):
  // a task can be checked off as complete but stays in its current column until every
  // subtask is done — only then does it move to the Done column.
  function cycleStage(id,evt){
    // Reentrancy guard: batched same-tick clicks (double-fire, scripted bursts)
    // collapse to one transition, so the WIP admit check can never be bypassed
    // by stale state read from the same closure. Real clicks are unaffected.
    if(cycleTickGuard.current.has(id))return;
    cycleTickGuard.current.add(id);
    Promise.resolve().then(()=>cycleTickGuard.current.delete(id));
    const x=tasks.find(t=>t.id===id);
    if(!x)return;
    const subs=x.subtasks||[];
    const allSubDone=subs.length===0||subs.every(s=>s.done);
    const isDone=x.completed||x.stage==='done';
    let patch;
    if(isDone){patch={completed:false,stage:x.stage==='done'?'doing':x.stage};} // uncheck → stay in current column (just leave the Done column)
    else if(x.stage==='todo'){patch={stage:'doing'};} // first tap → in progress
    else if(allSubDone){patch={completed:true,stage:'done'};} // complete → move to Done
    else{patch={completed:true,stage:'doing'};} // checked complete in place, stays in its column
    const run=()=>{
    if(patch.stage&&patch.stage!==x.stage)logEvent('task_moved',{taskId:id,from:x.stage,to:patch.stage,via:'check'});
    setTasks(ts=>ts.map(t=>t.id===id?{...t,...patch}:t));
    // First-time coach mark for the 3-state checkbox — taught in-product, once.
    if(patch.stage==='doing'&&!patch.completed&&!localStorage.getItem('heft.hint.cycle')){
      localStorage.setItem('heft.hint.cycle','1');
      showToast('In progress — tap the circle again to complete');
    }
    if(!patch.completed)dayCompleteFor.current=null; // unchecking re-arms the day moment
    // Celebration: burst at the checkbox on completion; day-complete moment when
    // this was the last unfinished task of the focused day (fires once per day).
    if(patch.completed){
      let cx=window.innerWidth/2,cy=window.innerHeight/2;
      if(evt&&evt.currentTarget&&evt.currentTarget.getBoundingClientRect){
        const r=evt.currentTarget.getBoundingClientRect();cx=r.left+r.width/2;cy=r.top+r.height/2;
      }else if(evt&&evt.clientX!=null){cx=evt.clientX;cy=evt.clientY;}
      const dk=dayKey(focusDate);
      const remaining=tasks.filter(t=>t.id!==id&&onDay(t,dk)&&t.stage!=='done'&&!t.completed).length;
      if(remaining===0&&dayCompleteFor.current!==dk){
        dayCompleteFor.current=dk;
        setTimeout(fireDayComplete,180);
        showToast('Day complete — everything’s done ✨');
      }else if(remaining>0){
        fireConfetti(cx,cy,1);
        if(CELEBRATE!=='off'){
          const msgs=['Nice — '+remaining+' left today','One down. '+remaining+' to go','Good momentum — '+remaining+' remaining','Done ✓','That one’s off your shoulders','Steady — '+remaining+' still open'];
          showToast(msgs[Math.floor(Math.random()*msgs.length)]);
        }
      }
    }
    };
    // Tapping a To Do card into In Progress is a real column entry, so it honours the limit too.
    if(patch.stage==='doing'&&!patch.completed&&x.stage==='todo'&&onDay(x,dayKey(focusDate)))admit('doing',id,run);
    else run();
  }

  const filteredTasks=useMemo(()=>{
    const dkey=dayKey(focusDate);
    let list=tasks.filter(t=>onDay(t,dkey));
    if(activeWeights.length>0)list=list.filter(t=>activeWeights.includes(t.weight));
    if(activeTag!==null)list=list.filter(t=>t.tag===activeTag);
    if(query.trim())list=list.filter(t=>t.name.toLowerCase().includes(query.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(query.trim().toLowerCase()));
    return list;
  },[tasks,activeWeights,activeTag,query,focusDate]);

  // Backlog: undated work. Uncapped, never day-scoped, same filters as the board.
  const backlogTasks=useMemo(()=>{
    let list=tasks.filter(isBacklog);
    if(activeWeights.length>0)list=list.filter(t=>activeWeights.includes(t.weight));
    if(activeTag!==null)list=list.filter(t=>t.tag===activeTag);
    if(query.trim())list=list.filter(t=>t.name.toLowerCase().includes(query.trim().toLowerCase())||(t.notes||'').toLowerCase().includes(query.trim().toLowerCase()));
    return list;
  },[tasks,activeWeights,activeTag,query]);

  // ===== WIP limits =====
  // A full column never blocks the action. It asks what comes out instead, and
  // "Go over anyway" is always one click away. Backlog and Done are never capped.
  function colCount(stage,exceptId){
    const dk=dayKey(focusDate);
    return tasks.filter(t=>t.id!==exceptId&&onDay(t,dk)&&t.stage===stage).length;
  }
  function admit(stage,taskId,apply){
    const lim=(wipLimits||WIP_DEFAULT)[stage]||0;
    if(!lim||stage==='done'||stage==='backlog'){apply();return;}
    const n=colCount(stage,taskId);
    if(n<lim){apply();return;}
    logEvent('swap_shown',{stage:stage,limit:lim,count:n});
    setSwap({stage,limit:lim,count:n,apply});
  }
  // Keep the drag engine reading live board state without re-arming on every render.
  const boardRef=useRef(null);
  boardRef.current={focusKey:dayKey(focusDate),admit};
  focusDateRef.current=focusDate;
  // FLIP glide: reset the rect map when the day or zoom changes so page turns
  // never glide across contexts. View is deliberately part of the glide — cards
  // morph between Board and Weight view like shared elements.
  useBoardFlip(dayKey(focusDate)+'|z'+zoom);

  function sendToBacklog(id){
    const t=tasks.find(x=>x.id===id);const prevDate=t?t.date:null;
    setTasks(ts=>ts.map(x=>x.id===id?{...x,date:null}:x));
    return prevDate;
  }
  function resolveSwap(outId){
    const s=swap;if(!s)return;
    const prev=sendToBacklog(outId);
    const out=tasks.find(x=>x.id===outId);
    logEvent('swap_resolved',{stage:s.stage,limit:s.limit,outId:outId});
    logEvent('backlog_added',{via:'swap',taskId:outId});
    setSwap(null);
    s.apply();
    showToast('Moved “'+((out&&out.name)||'task')+'” to Backlog',{label:'Undo',fn:()=>{
      setTasks(ts=>ts.map(x=>x.id===outId?{...x,date:prev}:x));
    }});
  }
  function overrideSwap(){
    const s=swap;if(!s)return;
    logEvent('limit_overridden',{stage:s.stage,limit:s.limit,count:s.count});
    setSwap(null);
    s.apply();
  }

  // apply accent + sync the browser/title-bar theme color to it
  // Set html[data-dark] synchronously during render — before paint — so the
  // status-bar safe-area region never flashes the wrong theme when toggling.
  // useEffect would be one frame too late and cause a visible flash.
  if(typeof document!=='undefined')document.documentElement.setAttribute('data-dark',dark?'true':'false');
  useEffect(()=>{
    const a=ACCENTS[accent];if(!a)return;
    const [av,ai]=dark?a.dark:a.light;
    const app=document.getElementById('app');
    if(app){app.style.setProperty('--accent',av);app.style.setProperty('--accent-ink',ai);}
    const probe=document.createElement('span');probe.style.color=av;document.body.appendChild(probe);
    const resolved=getComputedStyle(probe).color;probe.remove();
    let m=document.querySelector('meta[name="theme-color"]');
    if(!m){m=document.createElement('meta');m.name='theme-color';document.head.appendChild(m);}
    m.setAttribute('content',resolved);
  },[accent,dark]);

  // apply typeface — update root vars so every element on the page gets the new font
  useEffect(()=>{
    const f=FONT_SETS[typeface]||FONT_SETS.Minimal;
    const root=document.documentElement.style;
    // Drive EVERY font token from the setting so the switch propagates app-wide
    // (this was the bug: --font-mono/serif/script were never updated).
    root.setProperty('--font-ui',f.ui);
    root.setProperty('--font-display',f.display);
    root.setProperty('--font-serif',f.display);
    root.setProperty('--font-mono',f.ui);
    root.setProperty('--font-script',f.display);
  },[typeface]);

  // ── Instrumentation: one app_opened per load, one snapshot per calendar day ──
  const evOpened=useRef(false);
  useEffect(()=>{
    if(!loaded||evOpened.current)return;
    evOpened.current=true;
    logEvent('app_opened',{tasks:tasks.length});
    const today=todayKeyNow();
    let last=null;try{last=localStorage.getItem(EV_SNAP_KEY);}catch(_){}
    if(last!==today){
      try{localStorage.setItem(EV_SNAP_KEY,today);}catch(_){}
      const dk=today;
      const counts={todo:0,doing:0,done:0};
      tasks.forEach(t=>{if(onDay(t,dk)&&counts[t.stage]!==undefined)counts[t.stage]++;});
      logEvent('day_snapshot',{day:dk,todo:counts.todo,doing:counts.doing,done:counts.done,backlog:tasks.filter(isBacklog).length});
    }
  },[loaded]);

  // Decide onboarding once, after the initial cloud pull settles. Anyone with
  // existing tasks or habits is grandfathered in silently.
  useEffect(()=>{
    if(!loaded||onboardChecked.current)return;
    onboardChecked.current=true;
    if(localStorage.getItem(LS_ONBOARD_KEY))return;
    if(tasks.length===0&&habits.length===0)setShowOnboard(true);
    else localStorage.setItem(LS_ONBOARD_KEY,'1');
  },[loaded]);

  const lbl=fullDateLabel(focusDate);
  const [isMobile,setIsMobile]=useState(()=>typeof window!=='undefined'&&window.innerWidth<768);
  useEffect(()=>{
    function onR(){setIsMobile(window.innerWidth<768);}
    window.addEventListener('resize',onR);
    return()=>window.removeEventListener('resize',onR);
  },[]);
  // Day progress for the ring: all tasks on the focused day, unfiltered.
  const dayStats=useMemo(()=>{
    const dk=dayKey(focusDate);
    const list=tasks.filter(t=>onDay(t,dk));
    return{total:list.length,done:list.filter(t=>t.completed||t.stage==='done').length};
  },[tasks,focusDate]);

  // ===== Daily rollover: move the focused day's unfinished tasks to the next day =====
  const focusKey=dayKey(focusDate);
  const todayK=dayKey(todayDate());
  // Carrying from a past day brings tasks to TODAY, not to another day still in the past.
  const targetDate=dayKey(focusDate)<dayKey(todayDate())?todayDate():shiftDay(focusDate,1);
  const targetKey=dayKey(targetDate);
  const unfinished=useMemo(()=>tasks.filter(t=>onDay(t,focusKey)&&t.stage!=='done'&&!t.completed),[tasks,focusKey]);
  const nextLabel=targetDate.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const fromLabel=focusDate.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});

  // Single batched mutation — the whole sweep is one undo-able state update.
  function moveDayBulk(ids,key){setTasks(ts=>ts.map(x=>ids.includes(x.id)?{...x,date:key}:x));}

  // ===== Promote: a subtask becomes its own task =====
  // The parent is saved with the subtask removed and the new task is created in the
  // same state update, so Undo restores both halves exactly as they were.
  function promoteSubtask({parent,sub,index,tags:modalTags}){
    const before=tasks.find(t=>t.id===parent.id)||null;
    const child={
      id:uid(),seq:Date.now(),
      date:null, // lands in the Backlog so it gets prioritised deliberately, not dumped on today
      stage:'todo',name:sub.name,weight:'light',tag:parent.tag||'',
      subtasks:stepsOf(sub).map(p=>({id:uid(),name:p.name,done:!!p.done,steps:[]})),
      notes:'',completed:false,parentId:parent.id,childIds:[]
    };
    setTasks(ts=>{
      const has=ts.some(x=>x.id===parent.id);
      const next=has
        ?ts.map(x=>x.id===parent.id?{...x,...parent,childIds:[...(x.childIds||[]),child.id]}:x)
        :[...ts,{...parent,childIds:[child.id]}];
      return[...next,child];
    });
    if(modalTags)setTags(modalTags);
    setModal(null);
    logEvent('promote_fired',{parentId:parent.id,childId:child.id,steps:stepsOf(sub).length});
    promoteRef.current={before,childId:child.id,parentId:parent.id};
    showToast('Promoted “'+sub.name+'” to the Backlog',{label:'Undo',fn:()=>{
      const u=promoteRef.current;if(!u)return;
      setTasks(ts=>{
        let next=ts.filter(t=>t.id!==u.childId);
        if(u.before)next=next.map(t=>t.id===u.before.id?u.before:t);
        else next=next.filter(t=>t.id!==u.parentId);
        return next;
      });
      promoteRef.current=null;
      showToast('Promote undone');
    }});
  }

  function moveUnfinished(){
    if(unfinished.length===0)return;
    const moved=unfinished.map(t=>({id:t.id,date:t.date||todayKeyNow()}));
    moveDayBulk(moved.map(m=>m.id),targetKey);
    setBannerDismissed(d=>({...d,[focusKey]:true}));
    if(flashPill)flashPill('syncing');
    showToast('Moved '+moved.length+' to '+nextLabel,{label:'Undo',fn:()=>{
      setTasks(ts=>ts.map(t=>{const m=moved.find(x=>x.id===t.id);return m?{...t,date:m.date}:t;}));
    }});
  }

  // Carry-over pill → confirm dialog → batched move (no move on the pill click itself).
  function confirmCarry(){
    const moved=unfinished.map(t=>({id:t.id,date:t.date||todayKeyNow()}));const n=moved.length;
    if(n===0){setCarryOpen(false);return;}
    moveDayBulk(moved.map(m=>m.id),targetKey);
    setBannerDismissed(d=>({...d,[focusKey]:true}));
    setCarryOpen(false);
    if(flashPill)flashPill('syncing');
    showToast('Moved '+n+' to '+carryLabel(targetDate),{label:'Undo',fn:()=>{
      setTasks(ts=>ts.map(t=>{const m=moved.find(x=>x.id===t.id);return m?{...t,date:m.date}:t;}));
    }});
  }

  // re-evaluate the scheduled trigger on a minute tick while the app is open
  useEffect(()=>{
    if(rollover.mode!=='scheduled')return;
    const id=setInterval(()=>setRollTick(t=>t+1),60000);
    return()=>clearInterval(id);
  },[rollover.mode]);

  // does the active rollover mode want a prompt for the focused day right now?
  function rolloverTriggered(){
    if(unfinished.length===0||rollover.mode==='manual')return false;
    if(rollover.mode==='always')return true;
    if(rollover.mode==='newday')return focusKey<todayK;
    if(rollover.mode==='scheduled')return focusKey===todayK&&nowPastTime(rollover.time);
    return false;
  }
  const triggered=rolloverTriggered();
  const showBanner=triggered&&!rollover.auto&&!bannerDismissed[focusKey];
  // Tasks stranded on ANY past day are invisible from today's board — surface them here.
  const pastUnfinished=useMemo(()=>focusKey===todayK&&rollover.mode!=='manual'
    ?tasks.filter(t=>!isBacklog(t)&&taskDay(t)<todayK&&t.stage!=='done'&&!t.completed)
    :[],[tasks,focusKey,todayK,rollover.mode]);
  const showPastBanner=pastUnfinished.length>0&&!bannerDismissed['past:'+todayK];
  function rescuePast(){
    const moved=pastUnfinished.map(t=>({id:t.id,date:taskDay(t)}));
    moveDayBulk(moved.map(m=>m.id),todayK);
    setBannerDismissed(d=>({...d,['past:'+todayK]:true}));
    if(flashPill)flashPill('syncing');
    showToast('Brought '+moved.length+' to today',{label:'Undo',fn:()=>{
      setTasks(ts=>ts.map(t=>{const m=moved.find(x=>x.id===t.id);return m?{...t,date:m.date}:t;}));
    }});
  }
  // Same rescue, other destination: park it instead of forcing it onto today.
  function rescuePastToBacklog(){
    const moved=pastUnfinished.map(t=>({id:t.id,date:taskDay(t)}));
    if(moved.length===0)return;
    moveDayBulk(moved.map(m=>m.id),null);
    moved.forEach(m=>logEvent('backlog_added',{via:'rescue',taskId:m.id}));
    setBannerDismissed(d=>({...d,['past:'+todayK]:true}));
    if(flashPill)flashPill('syncing');
    showToast('Moved '+moved.length+' to Backlog',{label:'Undo',fn:()=>{
      setTasks(ts=>ts.map(t=>{const m=moved.find(x=>x.id===t.id);return m?{...t,date:m.date}:t;}));
    }});
  }

  // auto mode: fire the move silently (toast + Undo only) once the trigger is hot
  useEffect(()=>{
    if(triggered&&rollover.auto&&unfinished.length>0)moveUnfinished();
  },[triggered,rollover.auto,focusKey,rollTick,unfinished.length]);

  return(
    <div id="app" data-theme={dark?'dark':'light'} data-typeface={typeface} style={{display:'flex',flexDirection:'column',overflow:'hidden','--sidebar-w':(sidebarOpen?sidebarWidth:53)+'px'}}>

      {/* DESKTOP TOP BAR */}
      <div className="apptop--desk desktop-only">
        <div className="apptop__brandL"><HeftMark size={24}/><span className="apptop__brandLname">Heft</span></div>
        <div className="apptop__datenav">
          <button className="datenav__arrow" aria-label="Previous day" onClick={()=>setFocusDate(shiftDay(focusDate,-1))}><Icon name="chevL" size={18}/></button>
          <span className="datenav__date">{lbl.text}</span>
          <button className="datenav__arrow" aria-label="Next day" onClick={()=>setFocusDate(shiftDay(focusDate,1))}><Icon name="chevron" size={18}/></button>
          <DayProgress done={dayStats.done} total={dayStats.total}/>
        </div>
        <div className="apptop__rightZone">
          <div className="apptop__viewtoggle" role="group" aria-label="Board view" data-active={view}>
            <span className="viewtoggle__ind" aria-hidden="true"/>
            <button className="viewtoggle__opt" data-on={view==='kanban'?'true':'false'} onClick={()=>setView('kanban')}>Board</button>
            <button className="viewtoggle__opt" data-on={view==='weight'?'true':'false'} onClick={()=>setView('weight')}>Weight</button>
          </div>
          <span className="sync-wrap"><button className="apptop__gear" onClick={manualSync} title="Sync now" style={{opacity:syncing?0.5:1}}><Icon name="refresh" size={17}/></button>{saveError&&<span className="sync-err-dot" title="Unsaved changes — tap to retry"/>}</span>
          <button className="apptop__avatar" onClick={()=>setModal({type:'settings'})}>{profile.photo?<img src={profile.photo} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} alt=""/>:((profile.first[0]||'')+(profile.last[0]||'')).toUpperCase()||'U'}</button>
        </div>
      </div>

      {/* MOBILE TOP BAR — brand · avatar */}
      <div className="apptop mobile-only">
        <div className="apptop__brandL"><HeftMark size={22}/><span className="apptop__brandLname">Heft</span></div>
        <button className="apptop__avatar" onClick={()=>setModal({type:'settings'})}>{profile.photo?<img src={profile.photo} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}} alt=""/>:((profile.first[0]||'')+(profile.last[0]||'')).toUpperCase()||'U'}</button>
      </div>

      {/* MOBILE DATE BAR */}
      <div className="datebar mobile-only">
        <button className="datebar__panel" aria-label="Calendar, habits & filters" onClick={()=>setSidebarOpen(o=>!o)}><Icon name="filter" size={16}/>{saveError&&<span className="sync-err-dot" style={{position:'absolute',top:-3,right:-3}}/>}</button>
        <div className="datebar__center">
          <button className="datebar__arrow" aria-label="Previous day" onClick={()=>setFocusDate(shiftDay(focusDate,-1))}><Icon name="chevL" size={18}/></button>
          <div className="datebar__dateblock">
            <span className="datebar__date">{focusDate.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:focusDate.getFullYear()!==todayDate().getFullYear()?'numeric':undefined})}</span>
            {!lbl.isToday&&<button className="datebar__today" onClick={()=>setFocusDate(todayDate())}>Today</button>}
          </div>
          <button className="datebar__arrow" aria-label="Next day" onClick={()=>setFocusDate(shiftDay(focusDate,1))}><Icon name="chevron" size={18}/></button>
          <DayProgress done={dayStats.done} total={dayStats.total}/>
        </div>
        <button className="datebar__panel datebar__panel--right" aria-label={view==='kanban'?'Switch to Weight view':'Switch to Board view'} onClick={()=>setView(v=>v==='kanban'?'weight':'kanban')}><Icon name="layout" size={16}/></button>
      </div>

      {/* MAIN */}
      {saveError&&(
        <div className="save-err-banner" role="alert">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          <span>Changes not saved — you may be offline.</span>
          <button onClick={manualSync}>Retry</button>
        </div>
      )}
      <div className="appmain">
        <FilterSidebar open={sidebarOpen} onToggle={()=>setSidebarOpen(o=>!o)} activeWeights={activeWeights} toggleWeight={toggleWeight} activeTag={activeTag} setTag={setActiveTag} tags={tags} focusDate={focusDate} setFocusDate={setFocusDate} tasks={tasks} habits={habits} habitLog={habitLog} toggleHabit={toggleHabit} onManageHabits={()=>setModal({type:'habits'})} onManageTags={()=>setModal({type:'tags'})} query={query} setQuery={setQuery} width={sidebarWidth} resizing={resizing} onSync={manualSync} syncing={syncing} saveError={saveError}/>

        {sidebarOpen&&!isMobile&&(
          <div className="sidebar-resize desktop-only" data-active={resizing?'true':'false'}
            onMouseDown={(e)=>{
              e.preventDefault();
              const startX=e.clientX;const startW=sidebarWidth;setResizing(true);
              const move=(ev)=>{const w=Math.min(440,Math.max(200,startW+(ev.clientX-startX)));setSidebarWidth(w);};
              const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);document.body.style.cursor='';setResizing(false);};
              document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);document.body.style.cursor='col-resize';
            }}/>
        )}

        {/* mobile sidebar scrim */}
        {sidebarOpen&&isMobile&&<div className="drawer-scrim" onClick={()=>setSidebarOpen(false)}/>}

        <div className="board">
        <div className="board__zoom" key={dayKey(focusDate)} data-dir={dayNavDir.current===1?'next':dayNavDir.current===-1?'prev':undefined} style={{zoom:zoom}}>
          <FilterChips weights={activeWeights} tag={activeTag} query={query.trim()} clearWeight={toggleWeight} clearTag={()=>setActiveTag(null)} clearQuery={()=>setQuery('')}/>
          {view==='kanban'
            ?<KanbanView tasks={filteredTasks} backlog={backlogTasks} setTasks={setTasks} sort={sort} setSort={setSort} wipLimits={wipLimits} boardRef={boardRef} onOpenTask={(t)=>setModal({type:'task',data:t})} onAddTask={(stage)=>setModal({type:'task',data:stage==='backlog'?{stage:'todo',date:null}:{stage,date:dayKey(focusDate)}})} onCycle={cycleStage} defaultExpanded={subExpandDefault} onColScroll={logColumnScrolled}/>
            :<WeightView tasks={filteredTasks} setTasks={setTasks} onOpenTask={(t)=>setModal({type:'task',data:t})} onCycle={cycleStage} defaultExpanded={subExpandDefault}/>
          }
        </div>
        {/* Daily-rollover banner — in-flow at the bottom of the board, above the FAB */}
        {showBanner&&(
          <div className="rollbanner" role="status">
            <span className="rollbanner__txt"><strong>{unfinished.length} unfinished</strong> from {fromLabel} — Move to {nextLabel}?</span>
            <div className="rollbanner__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={moveUnfinished}><Icon name="arrowright" size={14}/>Move unfinished ({unfinished.length})</button>
              <button type="button" className="rollbanner__x" onClick={()=>setBannerDismissed(d=>({...d,[focusKey]:true}))} aria-label="Dismiss"><Icon name="x" size={14}/></button>
            </div>
          </div>
        )}
        {!showBanner&&showPastBanner&&(
          <div className="rollbanner" role="status">
            <span className="rollbanner__txt"><strong>{pastUnfinished.length} unfinished</strong> from earlier day{pastUnfinished.length===1?'':'s'} — bring {pastUnfinished.length===1?'it':'them'} to today?</span>
            <div className="rollbanner__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={rescuePast}><Icon name="carryover" size={14}/>Bring to today</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={rescuePastToBacklog}><Icon name="package" size={14}/>Move to Backlog</button>
              <button type="button" className="rollbanner__x" onClick={()=>setBannerDismissed(d=>({...d,['past:'+todayK]:true}))} aria-label="Dismiss"><Icon name="x" size={14}/></button>
            </div>
          </div>
        )}
        </div>

        {/* Templates popover */}
        {showTemplates&&(
          <TemplatesPopover
            templates={templates}
            onUse={(t)=>{
              const task={id:uid(),seq:Date.now(),date:dayKey(focusDate),stage:'todo',
                name:(t.includes&&t.includes.name&&t.taskName)||'',
                weight:(t.includes&&t.includes.weight&&t.weight)||'light',
                tag:(t.includes&&t.includes.tag&&t.tag)||'',
                subtasks:(t.includes&&t.includes.subtasks&&t.subtasks)?t.subtasks.map(function(x){return{id:uid(),name:x.name,done:false};}):[],
                notes:(t.includes&&t.includes.notes&&t.notes)||'',
                location:(t.includes&&t.includes.location&&t.location)||''
              };
              setTasks(function(ts){return[...ts,task];});
              logEvent('task_created',{stage:task.stage,weight:task.weight,backlog:false,via:'template'});
              setModal({type:'task',data:task});
              showToast('Created from template');
            }}
            onDelete={(id)=>{setTemplates(function(ts){return ts.filter(function(t){return t.id!==id;});});showToast('Template deleted');}}
            onNew={()=>{setShowTemplates(false);setSavingTemplate({});}}
            onClose={()=>setShowTemplates(false)}
          />
        )}





        {/* Offline takes priority — persistent until connection returns. Otherwise the transient sync pill. */}
        {offline?(
          <div className="syncpill" data-state="offline" role="status">
            <span className="syncpill__dot"/>
            <span>Offline — changes saved on this device</span>
          </div>
        ):syncPill&&(
          <div className="syncpill" data-state={syncPill.state} role="status">
            <span className="syncpill__dot"/>
            <span>{syncPill.state==='syncing'?'Syncing…':syncPill.state==='error'?'Sync failed':'Synced'}</span>
          </div>
        )}

        {/* Bottom-right dock — secondary "Carry over" pill beside the primary "Add task" FAB */}
        <div className="fabdock">
          {unfinished.length>0&&!query.trim()&&(focusKey<todayK||(focusKey===todayK&&new Date().getHours()>=17))&&!(showBanner||showPastBanner)&&(
            <button type="button" className="movepill" onClick={()=>setCarryOpen(true)} title={'Carry all unfinished tasks to '+carryLabel(targetDate)}>
              <Icon name="carryover" size={17}/>Carry over
            </button>
          )}
          <button className="fab" onClick={()=>setModal({type:'task',data:{stage:'todo',date:dayKey(focusDate)}})}><Icon name="plus" size={18}/>Add task</button>
        </div>

        {/* Toast */}
        {toast&&<div className="toast" data-leaving={toast.leaving?'true':'false'} role="status" style={{display:'flex',alignItems:'center',gap:10}}><span className="toast__msg">{toast.msg}</span>{toast.action&&<button className="toast__action" onClick={()=>{toast.action.fn();setToast(null);}}>{toast.action.label}</button>}</div>}

        {/* WIP swap sheet — a full column asks what comes out, it never blocks */}
        {swap&&(()=>{
          const dk=dayKey(focusDate);
          const inCol=sortTasks(tasks.filter(t=>onDay(t,dk)&&t.stage===swap.stage),sort);
          return(
          <div className="modal-scrim" onMouseDown={()=>closeModalAnimated(()=>setSwap(null))}>
            <div className="modal__panel modal__panel--swap" role="dialog" aria-modal="true" aria-label={STAGE_LABELS[swap.stage]+' is at its limit'} onMouseDown={(e)=>e.stopPropagation()}>
              <div className="swap__head">
                <span className="swap__ico"><Icon name="layout" size={20}/></span>
                <span className="swap__title">{STAGE_LABELS[swap.stage]} is full ({swap.count}/{swap.limit}).</span>
                <span className="swap__sub">What comes out?</span>
              </div>
              <div className="swap__list" role="list">
                {inCol.map(t=>(
                  <button key={t.id} type="button" role="listitem" className="swap__opt" style={{'--w':`var(--w-${t.weight||'none'})`}} onClick={()=>resolveSwap(t.id)}>
                    <span className="swap__opt__rail" aria-hidden="true"/>
                    <span className="swap__opt__name">{t.name}</span>
                    <span className="swap__opt__go"><Icon name="package" size={14}/>Backlog</span>
                  </button>
                ))}
                {inCol.length===0&&<div className="col__empty">Nothing to swap out</div>}
              </div>
              <div className="swap__foot">
                <button type="button" className="btn btn--ghost" onClick={()=>closeModalAnimated(()=>setSwap(null))}>Cancel</button>
                <button type="button" className="btn btn--ghost" onClick={overrideSwap}>Go over anyway</button>
              </div>
            </div>
          </div>);
        })()}

        {/* Carry-over confirm dialog */}
        {carryOpen&&(
          <div className="modal-scrim" onMouseDown={()=>closeModalAnimated(()=>setCarryOpen(false))}>
            <div className="modal__panel modal__panel--carry" role="dialog" aria-modal="true" aria-label="Carry over unfinished tasks" onMouseDown={(e)=>e.stopPropagation()}>
              <div className="modal__body carrydlg">
                <span className="carrydlg__ico"><Icon name="carryover" size={24}/></span>
                <span className="carrydlg__title">Carry over unfinished?</span>
                <span className="carrydlg__sub">All <strong>{unfinished.length}</strong> unfinished task{unfinished.length===1?'':'s'} still on <strong>{carryLabel(focusDate)}</strong> will move to <strong>{carryLabel(targetDate)}</strong>. Completed tasks stay put.</span>
              </div>
              <div className="carrydlg__foot">
                <button type="button" className="btn btn--ghost" onClick={()=>closeModalAnimated(()=>setCarryOpen(false))}>Cancel</button>
                <button type="button" className="btn btn--primary" onClick={confirmCarry}><Icon name="carryover" size={15}/>Carry over</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {modal?.type==='task'&&(
        <TaskModal
          initial={modal.data}
          tags={tags}
          onSave={(t,modalTags)=>{
            const prev=tasks.find(x=>x.id===t.id)||null;
            const wasNew=!prev;
            const entering=!isBacklog(t)&&onDay(t,dayKey(focusDate))&&(t.stage==='todo'||t.stage==='doing')&&(!prev||prev.stage!==t.stage||taskDay(prev)!==taskDay(t));
            setModal(null);
            const commit=()=>{
              setTasks(ts=>{const idx=ts.findIndex(x=>x.id===t.id);let next=idx>=0?ts.map(x=>x.id===t.id?t:x):[...ts,t];
                if(modalTags){const removed=tags.filter(x=>!modalTags.includes(x));if(removed.length)next=next.map(x=>removed.includes(x.tag)?{...x,tag:''}:x);}
                return next;});
              if(modalTags)setTags(modalTags);
              if(wasNew)logEvent('task_created',{stage:t.stage,weight:t.weight,backlog:isBacklog(t)});
              if(isBacklog(t)){if(wasNew||(prev&&!isBacklog(prev)))logEvent('backlog_added',{via:'editor',taskId:t.id});showToast(wasNew?'Added to Backlog':'Saved to Backlog');return;}
              if(prev&&isBacklog(prev))logEvent('backlog_pulled',{via:'editor',taskId:t.id,to:t.stage});
              const savedDay=taskDay(t);
              if(savedDay!==dayKey(focusDate)){showToast('Added to '+carryLabel(new Date(savedDay+'T00:00:00')),{label:'View',fn:()=>setFocusDate(new Date(savedDay+'T00:00:00'))});}
              else showToast(modal.data?.name?'Task saved':'Task added');
            };
            if(entering)admit(t.stage,t.id,commit);else commit();
          }}
          onDelete={(id)=>{
            const del=tasks.find(t=>t.id===id);
            // A promoted task must never leave a dangling link on its parent.
            const linked=tasks.filter(t=>(t.childIds||[]).indexOf(id)>=0).map(t=>t.id);
            setTasks(ts=>ts.filter(t=>t.id!==id).map(t=>(t.childIds||[]).indexOf(id)>=0?{...t,childIds:t.childIds.filter(c=>c!==id)}:t));
            if(del)setTaskArchive(a=>[{...del,archivedAt:Date.now()},...a.filter(x=>x.id!==id)]);
            setModal(null);
            undoRef.current={task:del,linked};
            showToast('Task archived',{label:'Undo',fn:()=>{
              const u=undoRef.current;const d=u&&u.task;
              if(d){
                setTaskArchive(a=>a.filter(x=>x.id!==d.id));
                setTasks(ts=>{
                  let next=ts.some(x=>x.id===d.id)?ts:[...ts,d];
                  if(u.linked&&u.linked.length)next=next.map(t=>u.linked.indexOf(t.id)>=0?{...t,childIds:[...(t.childIds||[]).filter(c=>c!==d.id),d.id]}:t);
                  return next;
                });
                undoRef.current=null;showToast('Task restored ✓');
              }
            }});
          }}
          onDuplicate={(t)=>{const copy={...t,id:uid(),seq:Date.now(),name:t.name+' (copy)',completed:false,stage:t.stage==='done'?'todo':t.stage,subtasks:(t.subtasks||[]).map(s=>({id:uid(),name:s.name,done:false,steps:stepsOf(s).map(p=>({id:uid(),name:p.name,done:false}))})),parentId:null,childIds:[]};setTasks(ts=>[...ts,copy]);showToast('Task duplicated');setModal(null);}}
          onSaveAsTemplate={(data)=>setSavingTemplate(data)}
          onMoveToDate={(id,dk)=>{setTasks(ts=>ts.map(t=>t.id===id?{...t,date:dk}:t));setFocusDate(new Date(dk+'T00:00:00'));showToast('Moved to '+new Date(dk+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}));setModal(null);}}
          onPromote={promoteSubtask}
          onClose={()=>closeModalAnimated(()=>setModal(null))}/>
      )}
      {modal?.type==='settings'&&(
        <SettingsModal profile={profile} userId={session.user.id} dark={dark} setDark={setDark} view={view} setView={setView} typeface={typeface} setTypeface={setTypeface} accent={accent} setAccent={setAccent} celebrate={celebrate} setCelebrate={setCelebrate} zoom={zoom} setZoom={setZoom} subExpandDefault={subExpandDefault} setSubExpandDefault={setSubExpandDefault} rollover={rollover} setRollover={setRollover} wipLimits={wipLimits} setWipLimits={setWipLimits} templatesCount={templates.length} onOpenTemplates={()=>{setModal(null);setShowTemplates(true);}} onSave={setProfile} onClearTasks={()=>{const dk=dayKey(focusDate);const removed=tasks.filter(t=>onDay(t,dk));if(removed.length){const stamp=Date.now();setTaskArchive(a=>[...removed.map(t=>({...t,archivedAt:stamp})),...a.filter(x=>!removed.some(r=>r.id===x.id))]);}setTasks(ts=>ts.filter(t=>!onDay(t,dk)));showToast(removed.length===1?'1 task archived for this day':removed.length+' tasks archived for this day');setModal(null);}} clearScopeLabel={fullDateLabel(focusDate).text} clearCount={tasks.filter(t=>onDay(t,dayKey(focusDate))).length} onOpenArchive={()=>setModal({type:'habitArchive'})} archiveCount={habitArchive.length+taskArchive.length} onPhotoSave={(url)=>{const updated={...profile,photo:url};setProfile(updated);const now=Date.now();lastSaveAt.current=now;const ts=new Date(now).toISOString();const blob={tasks,habits,habitLog,habitArchive,taskArchive,tags,profile:updated,dark,celebrate,view,typeface,accent,sidebarWidth,sort,rollover,templates,wipLimits,_savedAt:now};localStorage.setItem(LS_KEY,JSON.stringify(blob));if(!SANDBOX)sb.from('heft_state').upsert({user_id:session.user.id,data:blob,updated_at:ts},{onConflict:'user_id'});showToast('Profile photo synced ✓');}} onClose={()=>closeModalAnimated(()=>setModal(null))} onLogout={logout}/>
      )}
      {modal?.type==='habits'&&(
        <HabitManager habits={habits} onAdd={(name,icon,cadence)=>setHabits(hs=>[...hs,{id:uid(),name,icon:icon||'check',cadence:cadence||'daily'}])} onRemove={(id)=>{const h=habits.find(x=>x.id===id);setHabits(hs=>hs.filter(x=>x.id!==id));if(h){setHabitArchive(a=>[{...h,archivedAt:Date.now()},...a.filter(x=>x.id!==id)]);showToast('Habit archived',{label:'Undo',fn:()=>{setHabitArchive(a=>a.filter(x=>x.id!==id));setHabits(hs=>hs.some(x=>x.id===id)?hs:[...hs,h]);}});}}} onEdit={(id,patch)=>setHabits(hs=>hs.map(h=>h.id===id?{...h,...patch}:h))} onClose={()=>closeModalAnimated(()=>setModal(null))}/>
      )}
      {modal?.type==='habitArchive'&&(
        <ArchiveModal taskArchive={taskArchive} habitArchive={habitArchive}
          onRecoverTask={(id)=>{const t=taskArchive.find(x=>x.id===id);if(!t)return;const rest={...t};delete rest.archivedAt;setTasks(ts=>ts.some(x=>x.id===id)?ts:[...ts,rest]);setTaskArchive(a=>a.filter(x=>x.id!==id));showToast('Task recovered ✓');}}
          onDeleteTask={(id)=>{setTaskArchive(a=>a.filter(x=>x.id!==id));showToast('Task permanently deleted');}}
          onRecoverTasksForDay={(dk)=>{const group=taskArchive.filter(t=>(t.date||'')===dk);if(!group.length)return;setTasks(ts=>{const have=new Set(ts.map(x=>x.id));return[...ts,...group.filter(t=>!have.has(t.id)).map(t=>{const r={...t};delete r.archivedAt;return r;})];});setTaskArchive(a=>a.filter(t=>(t.date||'')!==dk));showToast(group.length===1?'1 task restored':group.length+' tasks restored ✓');}}
          onRecoverHabit={(id)=>{const h=habitArchive.find(x=>x.id===id);if(!h)return;const rest={...h};delete rest.archivedAt;setHabits(hs=>hs.some(x=>x.id===id)?hs:[...hs,rest]);setHabitArchive(a=>a.filter(x=>x.id!==id));showToast('Habit recovered ✓');}}
          onDeleteHabit={(id)=>{setHabitArchive(a=>a.filter(x=>x.id!==id));setHabitLog(log=>{const n={...log};delete n[id];return n;});showToast('Habit permanently deleted');}}
          onClose={()=>closeModalAnimated(()=>setModal(null))}/>
      )}
      {savingTemplate&&(
        <SaveTemplateDialog
          taskData={savingTemplate}
          onSave={(t)=>{setTemplates(function(ts){return[...ts,t];});setSavingTemplate(null);showToast('Template saved');}}
          onClose={()=>setSavingTemplate(null)}/>
      )}
      {modal?.type==='tags'&&(
        <TagManager tags={tags} onAdd={(name)=>setTags(ts=>ts.includes(name)?ts:[...ts,name])} onRemove={(name)=>{setTags(ts=>ts.filter(t=>t!==name));setTasks(ts=>ts.map(t=>t.tag===name?{...t,tag:''}:t));if(activeTag===name)setActiveTag(null);}} onRename={(old,next)=>{setTags(ts=>ts.map(t=>t===old?next:t));setTasks(ts=>ts.map(t=>t.tag===old?{...t,tag:next}:t));if(activeTag===old)setActiveTag(next);}} onClose={()=>closeModalAnimated(()=>setModal(null))}/>
      )}
      {showOnboard&&(
        <Onboarding
          firstName={profile.first}
          onCreateTask={({name,weight})=>setTasks(ts=>[...ts,{id:uid(),seq:Date.now(),date:todayKeyNow(),name,weight,stage:'todo',completed:false,tag:'',notes:'',subtasks:[]}])}
          onCreateHabit={({name,icon})=>setHabits(hs=>[...hs,{id:uid(),name,icon,cadence:'daily'}])}
          onFinish={()=>{localStorage.setItem(LS_ONBOARD_KEY,'1');setShowOnboard(false);}}/>
      )}
    </div>
  );
}

// ===== LOGIN SCREEN =====
function LoginScreen(){
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[mode,setMode]=useState('signin');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const sysDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
  // Set synchronously during render so the status-bar safe area matches immediately.
  if(typeof document!=='undefined')document.documentElement.setAttribute('data-dark',sysDark?'true':'false');
  const[first,setFirst]=useState('');
  const[last,setLast]=useState('');
  async function submit(e){
    e.preventDefault();
    if(!email.trim()||!password.trim())return;
    if(mode==='signup'&&(!first.trim()||!last.trim())){setError('Please enter your first and last name.');return;}
    setBusy(true);setError('');
    if(mode==='signup'){
      const{error:err}=await sb.auth.signUp({email:email.trim(),password,options:{data:{first_name:first.trim(),last_name:last.trim()}}});
      if(err){setError(err.message);setBusy(false);return;}
      const{error:err2}=await sb.auth.signInWithPassword({email:email.trim(),password});
      if(err2)setError('Account created — now sign in.');
    } else {
      const{error:err}=await sb.auth.signInWithPassword({email:email.trim(),password});
      if(err)setError(err.message==='Invalid login credentials'?'Wrong email or password.':err.message);
    }
    setBusy(false);
  }
  return(
    <div id="app" data-theme={sysDark?'dark':'light'} className="login">
      <div className="login__hero">
        <HeftMark size={42}/>
        <h1 className="login__brand">Heft</h1>
        <span className="login__stamp">Prioritize what matters</span>
      </div>
      <form onSubmit={submit} className="login__card">
        {mode==='signup'&&(
          <div style={{display:'flex',gap:10}}>
            <input className="login__input" type="text" value={first} placeholder="First name" autoFocus onChange={(e)=>setFirst(e.target.value)}/>
            <input className="login__input" type="text" value={last} placeholder="Last name" onChange={(e)=>setLast(e.target.value)}/>
          </div>
        )}
        <input className="login__input" type="email" value={email} placeholder="you@example.com" onChange={(e)=>setEmail(e.target.value)}/>
        <input className="login__input" type="password" value={password} placeholder="Password (6+ characters)" onChange={(e)=>setPassword(e.target.value)}/>
        {error&&<p className="login__err">{error}</p>}
        <button type="submit" className="login__cta" disabled={busy||!email.trim()||!password.trim()}>{busy?(mode==='signup'?'Creating…':'Signing in…'):(mode==='signup'?'Create account':'Sign in')}</button>
        <p className="login__alt">
          {mode==='signin'?<React.Fragment>No account? <button type="button" className="login__lnk" onClick={()=>{setMode('signup');setError('');}}>Create one</button></React.Fragment>:<React.Fragment>Have an account? <button type="button" className="login__lnk" onClick={()=>{setMode('signin');setError('');}}>Sign in</button></React.Fragment>}
        </p>
      </form>
      <span className="login__foot">Your day, weighed.</span>
    </div>
  );
}

// ===== ROOT (auth gate) =====
// ── Full-screen branded splash shown on every cold open ──────────────────
function AppSplash(){
  const sysDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
  // Set synchronously during render — useEffect runs after first paint, which caused
  // the status-bar safe area to flash the default light cream on cold boot.
  if(typeof document!=='undefined')document.documentElement.setAttribute('data-dark',sysDark?'true':'false');
  return(
    <div id="app" data-theme={sysDark?'dark':'light'}
      style={{display:'flex',flexDirection:'column',alignItems:'center',
              justifyContent:'center',gap:20,background:'var(--bg)'}}>
      <style>{`
        @keyframes heftBarIn{0%{transform:scaleY(0);opacity:0}100%{transform:scaleY(1);opacity:1}}
        @keyframes heftWordIn{0%{opacity:0;transform:translateY(8px)}100%{opacity:1;transform:none}}
        .splash-bar{transform-box:fill-box;transform-origin:50% 100%;
          animation:heftBarIn .55s cubic-bezier(.2,.9,.3,1.3) both;}
        .splash-bar:nth-child(1){animation-delay:.05s}
        .splash-bar:nth-child(2){animation-delay:.15s}
        .splash-bar:nth-child(3){animation-delay:.25s}
        .splash-bar:nth-child(4){animation-delay:.35s}
      `}</style>
      <svg width={72} height={64} viewBox="0 0 22 20" aria-hidden="true">
        <rect className="splash-bar" x="1"  y="13" width="4"   height="6"  rx="1.2" fill="var(--w-light)"/>
        <rect className="splash-bar" x="7"  y="9"  width="4"   height="10" rx="1.2" fill="var(--w-medium)"/>
        <rect className="splash-bar" x="13" y="4"  width="4"   height="15" rx="1.2" fill="var(--w-heavy)"/>
        <rect className="splash-bar" x="19" y="11" width="2.6" height="8"  rx="1.2" fill="var(--w-extra)"/>
      </svg>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,
                   animation:'heftWordIn .5s ease both .5s'}}>
        <span style={{fontFamily:'var(--font-serif)',fontSize:34,fontWeight:600,
                      color:'var(--text)',letterSpacing:'-0.02em',lineHeight:1}}>Heft</span>
        <span className="splash__stamp">Prioritize what matters</span>
      </div>
    </div>
  );
}

function Root(){
  const[session,setSession]=useState(SANDBOX?{user:{id:'sandbox-user',email:'sandbox@heft.test',user_metadata:{first_name:'Sandbox',last_name:'Tester'}}}:null);
  const[loading,setLoading]=useState(!SANDBOX);
  // Guarantee splash shows for at least 1.8s even on fast connections
  const[splashDone,setSplashDone]=useState(false);
  useEffect(()=>{
    const t=setTimeout(()=>setSplashDone(true),SANDBOX?300:900);
    return()=>clearTimeout(t);
  },[]);
  useEffect(()=>{
    if(SANDBOX)return;
    sb.auth.getSession().then(({data:{session}})=>{setSession(session);setLoading(false);});
    const{data:{subscription}}=sb.auth.onAuthStateChange((_,s)=>{setSession(s);setLoading(false);});
    return()=>subscription.unsubscribe();
  },[]);
  // Show splash until BOTH: auth resolved AND minimum time elapsed
  if(loading||!splashDone)return<AppSplash/>;
  if(!session)return<LoginScreen/>;
  return<App session={session}/>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
registerHeftSW();
