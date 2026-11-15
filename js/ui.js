/* ui.js: small reusable UI pieces (no dependencies)
   makeSlider(el, opts)  an animated slider with optional discrete steps (thumb follows the finger, then springs to the step)
   sheetDrag(wrap, close) lets a bottom sheet be pulled down with a finger or the mouse (by its handle or header) */

/* opts: {min, max, step, value, onChange(v), ticks (draw step dots, default: when <= 24 steps)}
   returns {get(), set(v)}; the element also gets .setValue(v) */
function makeSlider(el,{min=0,max=10,step=1,value=0,onChange=()=>{},ticks}){
  const n=Math.round((max-min)/step);
  el.classList.add('slider');
  el.innerHTML='<div class="trk"><i class="fill"></i></div><b class="thumb"></b>';
  const trk=el.querySelector('.trk');
  if(ticks===undefined?n<=24:ticks){for(let k=0;k<=n;k++){const t=document.createElement('i');t.className='tick';t.style.left=(100*k/n)+'%';trk.appendChild(t);}}
  let v=value,drag=false,pid=null,snapT=0;
  el.setAttribute('role','slider');el.setAttribute('tabindex','0');
  el.setAttribute('aria-valuemin',min);el.setAttribute('aria-valuemax',max);
  const snap=x=>Math.max(min,Math.min(max,Math.round((x-min)/step)*step+min));
  const setP=p=>el.style.setProperty('--p',p);
  const pOf=x=>(x-min)/(max-min);
  const buzz=()=>{try{navigator.vibrate&&navigator.vibrate(5)}catch(_){}};
  function show(animate){el.classList.toggle('snap',animate);setP(pOf(v));el.setAttribute('aria-valuenow',v);}
  function set(nv,fire=true){nv=snap(nv);const ch=nv!==v;v=nv;show(true);if(ch&&fire)onChange(v);}
  function fromEvent(e){const r=trk.getBoundingClientRect();return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));}
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0)return;
    drag=true;pid=e.pointerId;try{el.setPointerCapture(pid)}catch(_){}
    el.classList.add('drag');
    const p=fromEvent(e),nv=snap(min+p*(max-min));
    el.classList.add('snap');setP(p);                // a tap glides to the touched place...
    clearTimeout(snapT);snapT=setTimeout(()=>{if(drag)el.classList.remove('snap');},170);   // ...then the thumb follows the finger 1:1
    if(nv!==v){v=nv;el.setAttribute('aria-valuenow',v);buzz();onChange(v);}
    e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==pid)return;
    const p=fromEvent(e),nv=snap(min+p*(max-min));
    setP(p);
    if(nv!==v){v=nv;el.setAttribute('aria-valuenow',v);buzz();onChange(v);}
  });
  const end=e=>{if(!drag||(e&&e.pointerId!==pid))return;drag=false;el.classList.remove('drag');show(true);};   // spring to the step
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  el.addEventListener('keydown',e=>{
    const k=e.key;let nv=v;
    if(k==='ArrowLeft'||k==='ArrowDown')nv=v-step;else if(k==='ArrowRight'||k==='ArrowUp')nv=v+step;
    else if(k==='Home')nv=min;else if(k==='End')nv=max;
    else if(k==='PageDown')nv=v-step*Math.max(1,Math.round(n/5));else if(k==='PageUp')nv=v+step*Math.max(1,Math.round(n/5));
    else return;
    e.preventDefault();set(nv);buzz();
  });
  el.setValue=set;
  v=snap(value);show(false);
  return{get:()=>v,set};
}

/* pull a bottom sheet down to close it. zones: the handle and the header (not the buttons inside them) */
function sheetDrag(wrap,close){
  const sheet=wrap.querySelector('.sheet');
  let drag=false,pid=null,y0=0,dy=0,lastY=0,lastT=0,vel=0;
  wrap.querySelectorAll('.grab,.shd').forEach(z=>{
    z.addEventListener('pointerdown',e=>{
      if(e.target.closest('button'))return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      drag=true;pid=e.pointerId;try{z.setPointerCapture(pid)}catch(_){}
      y0=lastY=e.clientY;lastT=performance.now();dy=0;vel=0;
      sheet.style.transition='none';wrap.style.transition='none';
    });
    z.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==pid)return;
      dy=Math.max(0,e.clientY-y0);
      const now=performance.now();vel=(e.clientY-lastY)/Math.max(1,now-lastT);lastY=e.clientY;lastT=now;
      sheet.style.transform='translateY('+dy+'px)';
      wrap.style.opacity=String(Math.max(.2,1-dy/Math.max(200,sheet.offsetHeight)*1.1));
    });
    const end=e=>{
      if(!drag||(e&&e.pointerId!==pid))return;
      drag=false;sheet.style.transition='';wrap.style.transition='';
      if(dy>sheet.offsetHeight*.28||vel>.7){
        sheet.style.transform='translateY(100%)';wrap.style.opacity='0';
        setTimeout(()=>{close();sheet.style.transform='';wrap.style.opacity='';},270);
      }else{sheet.style.transform='';wrap.style.opacity='';}   // not far enough: spring back
    };
    z.addEventListener('pointerup',end);z.addEventListener('pointercancel',end);
  });
}
