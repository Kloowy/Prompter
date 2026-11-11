const $=s=>document.querySelector(s);
/* app.js: UI, reader, microphone glue, search glue, chapters, file loading.
   Brain parts live elsewhere: js/match.js (speech -> position), js/markdown.js (parser), js/search.js (fuzzy find).
   Sections: 1 state/setup  2 build text  3 position + highlight  4 paragraphs/chapters  5 microphone  6 search  7 buttons */
/* ===== 1. state + setup screen ===== */
let words=[],wn=[],wf=[],paras=[],chapters=[],sents={},pos=0,follow=true,rec=null,wantRec=false,lock=null,reading=false,mdOn=false,mdTouched=false,hdSpoken=false,jumpsOn=true,agg=50,leadW=1,sentOn=false,col=780,dbgOn=false,mw=[],mmap=[],rmap=[];
const APP_VERSION='v19';
let fs=Math.round(Math.min(40,Math.max(24,innerWidth/13)));
try{const v=+localStorage.getItem('sf_fs');if(v>=16&&v<=72)fs=v;}catch(e){}
document.documentElement.style.setProperty('--fs',fs+'px');

try{const t=localStorage.getItem('sf_t');if(t)$('#src').value=t;const l=localStorage.getItem('sf_l2');if(l)$('#lang').value=l;hdSpoken=localStorage.getItem('sf_hd')==='1';{const cv=+localStorage.getItem('sf_col');if(cv>=480&&cv<=1400)col=Math.round(cv/20)*20;{const lw=localStorage.getItem('sf_leadw'),lv=localStorage.getItem('sf_lead');if(lw!==null&&!isNaN(+lw))leadW=Math.max(0,Math.min(3,+lw|0));else if(lv!==null&&!isNaN(+lv))leadW=[0,0,0,1,1,1,1,1,2,2,3][Math.round(+lv/10)]||0;}sentOn=localStorage.getItem('sf_sent')==='1';dbgOn=localStorage.getItem('sf_dbg')==='1';hearOn=localStorage.getItem('sf_hear')==='1';agg=Math.round(agg/10)*10;const jv=localStorage.getItem('sf_jump');if(jv!==null)jumpsOn=jv==='1';const av=localStorage.getItem('sf_agg');if(av!==null&&!isNaN(+av))agg=Math.max(0,Math.min(100,+av));}const eg=localStorage.getItem('sf_eng');if(eg&&$('#eng'))$('#eng').value=eg;const m=localStorage.getItem('sf_md');if(m!==null){mdOn=m==='1';mdTouched=true;}}catch(e){}

const langSel=$('#lang'),autoOpt=langSel.querySelector('option[value="auto"]');
function showDetected(){
  const d=detectLang($('#src').value),o=d&&langSel.querySelector('option[value="'+d+'"]');
  autoOpt.textContent=o?'Auto-detect · '+o.textContent.replace(/ \(US\)$/,''):'Auto-detect';
}
function spokenLang(){
  if(langSel.value!=='auto')return langSel.value;
  return detectLang($('#src').value)||'en-US';
}
function setMd(on){mdOn=on;$('#mdt').setAttribute('aria-pressed',on);$('#mdp').setAttribute('aria-pressed',!on)}
let detT=0;
$('#src').addEventListener('input',()=>{clearTimeout(detT);detT=setTimeout(()=>{showDetected();if(!mdTouched)setMd(mdDetect($('#src').value))},300)});
$('#mdt').onclick=()=>{mdTouched=true;setMd(true)};
$('#mdp').onclick=()=>{mdTouched=true;setMd(false)};
function syncEng(){document.querySelectorAll('#engseg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===$('#eng').value))}
document.querySelectorAll('#engseg button').forEach(b=>b.onclick=()=>{$('#eng').value=b.dataset.v;syncEng();});
syncEng();
showDetected();
if(!mdTouched)mdOn=mdDetect($('#src').value);
setMd(mdOn);

/* open a .md / .txt file (button, or drag & drop on desktop) */
async function loadFile(f){
  if(!f)return;
  const nm=$('#fname');
  if(f.size>3e6){nm.textContent='File is too big (max 3 MB)';return;}
  let t='';try{t=await f.text();}catch(e){nm.textContent='Could not read the file';return;}
  if(t.includes('\u0000')){nm.textContent='This does not look like a text file';return;}
  $('#src').value=t.replace(/^\uFEFF/,'');
  nm.textContent=f.name;
  mdTouched=false;
  setMd(/\.(md|markdown|mdown|mkd)$/i.test(f.name)||mdDetect(t));
  showDetected();
}
$('#file').onclick=()=>$('#fin').click();
$('#fin').onchange=e=>{loadFile(e.target.files[0]);e.target.value=''};
const setupEl=$('#setup');
['dragenter','dragover'].forEach(n=>setupEl.addEventListener(n,e=>{e.preventDefault();setupEl.classList.add('drag')}));
['dragleave','drop'].forEach(n=>setupEl.addEventListener(n,e=>{e.preventDefault();setupEl.classList.remove('drag')}));
setupEl.addEventListener('drop',e=>loadFile(e.dataTransfer&&e.dataTransfer.files[0]));

/* ===== 2. build the text ===== */
const fcls=f=>(f&1?'fb ':'')+(f&2?'fi ':'')+(f&4?'fc ':'')+(f&8?'fs ':'')+(f&16?'fa ':'');
/* Every reading unit (paragraph, heading, list item, code block, table) becomes a "block" (.blk, entry in paras[]).
   Every word is a span.w > span.t with an entry in words[] / wn[] (for speech) / wf[] (for search). */
function build(text,md){
  const box=$('#text');
  box.innerHTML='<svg id="hl" aria-hidden="true"><path/></svg>';
  words=[];wn=[];wf=[];paras=[];chapters=[];sents={};tierP=-1;rdP=-1;rdTo=0;csSid=-1;cancelGlide();resetSimCache();
  let sid=0,cur=-1,curHead=false;
  const open=el=>{cur=paras.length;paras.push({el,first:words.length,last:-1,h:curHead});box.appendChild(el);return el;};
  const put=(target,toks)=>{
    for(const tok of toks){
      const s=document.createElement('span');s.className='w';
      const t=document.createElement('span');t.className='t';
      let plain='';
      for(const pc of tok.pieces){
        plain+=pc.t;
        if(pc.f){const e=document.createElement('span');e.className=fcls(pc.f);e.textContent=pc.t;t.appendChild(e);}
        else t.appendChild(document.createTextNode(pc.t));
      }
      s.append(t,tok.sep);target.appendChild(s);
      const idx=words.length;
      words.push({el:s,p:cur,s:sid,h:curHead});wn.push(norm(plain));wf.push(fold(plain));
      (sents[sid]=sents[sid]||[]).push(idx);
      s.onclick=()=>manualJump(idx);
      if(/[.!?…]["'»”’)\]]*$/.test(plain))sid++;
    }
  };
  const close=()=>{   // false (and the block is dropped) if it ended up with no words
    const b=paras[cur];b.last=words.length-1;
    if(b.last<b.first){b.el.remove();paras.pop();cur=paras.length-1;return false;}
    sid++;return true;
  };
  if(!md){
    text.split(/\n+/).map(s=>s.trim()).filter(Boolean).forEach(line=>{
      const p=open(document.createElement('p'));p.className='blk';put(p,plainTokens(line));close();
    });
  }else{
    for(const n of mdParse(text)){
      if(n.type==='hr'){box.appendChild(document.createElement('hr'));continue;}
      let el;
      if(n.type==='h'){el=document.createElement('h'+n.level);el.className='blk h';}
      else if(n.type==='li'){el=document.createElement('div');el.className='blk li'+(n.task?' task '+n.task:'');el.dataset.m=n.marker;el.style.setProperty('--lv',n.level);}
      else if(n.type==='code'){el=document.createElement('pre');el.className='blk code';}
      else if(n.type==='table'){el=document.createElement('div');el.className='blk tbl';}
      else{el=document.createElement('p');el.className='blk';}
      if(n.q)el.classList.add('q');
      curHead=n.type==='h';
      open(el);const startW=words.length;
      if(n.type==='table'){
        const tb=document.createElement('table');
        n.rows.forEach((r,ri)=>{
          const tr=document.createElement('tr');
          r.forEach(c=>{const td=document.createElement(ri===0&&n.head?'th':'td');put(td,mdTokens(mdInline(c)));sid++;tr.appendChild(td);});
          tb.appendChild(tr);
        });
        el.appendChild(tb);
      }else if(n.type==='code')put(el,codeTokens(n.text));
      else put(el,mdTokens(mdInline(n.text)));
      if(close()&&n.type==='h')chapters.push({first:startW,end:words.length-1,level:n.level,title:words.slice(startW).map(w=>w.el.firstChild.textContent).join(' ')});
    }
    if(chapters.length){const mn=Math.min(...chapters.map(c=>c.level));chapters=chapters.filter(c=>c.level<=mn+2);}
  }
  $('#reader').classList.toggle('hasch',chapters.length>0);
  curCh=-2;applyHd();
}

/* ===== 3. current position + highlight ===== */
let curW=-1;
/* progress counts only the words that are actually said: headings do not move it while Sync headings is off */
function updateProg(i){const n=mw.length;$('#prog i').style.transform='scaleX('+(n>1?Math.min(1,(rmap[i]||0)/(n-1)).toFixed(4):0)+')';}
/* past / now / next: paragraphs before the current one fade (.past); inside the current one, words already said dim (.rd) */
let tierP=-1,rdP=-1,rdTo=0,csSid=-1;
function setTiers(pi){
  if(tierP<0){for(let k=0;k<paras.length;k++)paras[k].el.classList.toggle('past',k<pi);}
  else if(pi>tierP){for(let k=tierP;k<pi;k++)paras[k].el.classList.add('past');}
  else if(pi<tierP){for(let k=pi;k<tierP;k++)paras[k].el.classList.remove('past');}
  tierP=pi;
}
function setRead(i){
  const pi=words[i].p,p=paras[pi];
  if(rdP!==pi){
    if(rdP>=0&&paras[rdP])for(let k=paras[rdP].first;k<=paras[rdP].last;k++)words[k].el.classList.remove('rd');
    rdP=pi;rdTo=p.first;
  }
  if(i>rdTo){for(let k=rdTo;k<i;k++)words[k].el.classList.add('rd');}
  else if(i<rdTo){for(let k=i;k<rdTo;k++)words[k].el.classList.remove('rd');}
  rdTo=i;
}
function setPos(i,smooth=true,force=false){
  if(!words.length)return;
  i=Math.max(0,Math.min(words.length-1,i));
  const newSent=curW<0||words[curW].s!==words[i].s;
  if(curW>=0){
    const o=words[curW];
    o.el.classList.remove('cur');
    if(words[i].p!==o.p)paras[o.p].el.classList.remove('act');
  }
  curW=pos=i;
  const w=words[i];
  w.el.classList.add('cur');
  paras[w.p].el.classList.add('act');
  setTiers(w.p);setRead(i);
  updateProg(i);
  if(newSent){
    if(csSid>=0&&sents[csSid])for(const k of sents[csSid])words[k].el.classList.remove('cs');
    csSid=w.s;for(const k of sents[csSid])words[k].el.classList.add('cs');
    drawSent();
  }
  updChap();
  if(follow)followTo(i,smooth,force);else backDir();
}
/* Outline of the current sentence: its line boxes are stacked edge to edge and traced as one
   polygon with rounded corners (concave ones too), so a multi-line sentence reads as a single shape. */
function drawSent(){
  const path=document.querySelector('#hl path');if(!path)return;
  if(curW<0){path.setAttribute('d','');return;}
  const box=$('#text'),br=box.getBoundingClientRect(),ids=sents[words[curW].s];
  const rg=document.createRange();
  rg.setStartBefore(words[ids[0]].el.firstChild);rg.setEndAfter(words[ids[ids.length-1]].el.firstChild);
  const lines=[];
  for(const r of rg.getClientRects()){
    if(r.width<1||r.height<1)continue;
    const cy=(r.top+r.bottom)/2;let L=lines.find(l=>Math.abs(l.cy-cy)<fs*.4);
    if(!L)lines.push({cy,x1:r.left,x2:r.right,t:r.top,b:r.bottom});
    else{L.x1=Math.min(L.x1,r.left);L.x2=Math.max(L.x2,r.right);L.t=Math.min(L.t,r.top);L.b=Math.max(L.b,r.bottom);}
  }
  if(!lines.length){path.setAttribute('d','');return;}
  lines.sort((a,b)=>a.t-b.t);
  const ox=box.scrollLeft-br.left,oy=box.scrollTop-br.top,px=fs*.22,py=fs*.08,rad=fs*.3;
  lines.forEach(l=>{l.x1+=ox-px;l.x2+=ox+px;l.t+=oy;l.b+=oy;});
  lines[0].t-=py;lines[lines.length-1].b+=py;
  for(let i=0;i+1<lines.length;i++){const m=(lines[i].b+lines[i+1].t)/2;lines[i].b=lines[i+1].t=m;}
  // split into groups of lines that overlap horizontally enough to be joined
  const groups=[[lines[0]]];
  for(let i=1;i<lines.length;i++){
    const a=lines[i-1],b=lines[i];
    if(Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1)>rad*2.5)groups[groups.length-1].push(b);else groups.push([b]);
  }
  let d='';
  for(const g of groups){
    // snap nearly aligned edges so ragged/justified lines don't create tiny steps
    for(let i=1;i<g.length;i++){
      if(Math.abs(g[i].x2-g[i-1].x2)<rad*1.5){const v=Math.max(g[i].x2,g[i-1].x2);for(let k=i;k>=0&&Math.abs(g[k].x2-v)<rad*1.5;k--)g[k].x2=v;}
      if(Math.abs(g[i].x1-g[i-1].x1)<rad*1.5){const v=Math.min(g[i].x1,g[i-1].x1);for(let k=i;k>=0&&Math.abs(g[k].x1-v)<rad*1.5;k--)g[k].x1=v;}
    }
    let pts=[];
    g.forEach(l=>pts.push([l.x2,l.t],[l.x2,l.b]));
    for(let i=g.length-1;i>=0;i--)pts.push([g[i].x1,g[i].b],[g[i].x1,g[i].t]);
    // drop duplicate and collinear points
    for(let ch=true;ch;){
      ch=false;
      for(let i=0;i<pts.length&&pts.length>3;i++){
        const a=pts[(i+pts.length-1)%pts.length],p=pts[i],b=pts[(i+1)%pts.length];
        if((Math.abs(a[0]-p[0])<.5&&Math.abs(a[1]-p[1])<.5)||Math.abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))<.5){pts.splice(i,1);ch=true;break;}
      }
    }
    const n=pts.length,f=v=>v.toFixed(1);
    pts.forEach((p,i)=>{
      const a=pts[(i+n-1)%n],b=pts[(i+1)%n];
      const la=Math.hypot(a[0]-p[0],a[1]-p[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]),r=Math.min(rad,la/2,lb/2);
      const p1=[p[0]+(a[0]-p[0])/la*r,p[1]+(a[1]-p[1])/la*r],p2=[p[0]+(b[0]-p[0])/lb*r,p[1]+(b[1]-p[1])/lb*r];
      d+=(i?'L':'M')+f(p1[0])+' '+f(p1[1])+'Q'+f(p[0])+' '+f(p[1])+' '+f(p2[0])+' '+f(p2[1]);
    });
    d+='Z';
  }
  path.setAttribute('d',d);
}
addEventListener('resize',()=>{if(reading){measureBars();drawSent();if(follow&&words.length)centerPos(false);}});
/* The bars float above the text: measure them so scrolling never parks a word underneath one. */
let barB=0,footH=0;
function measureBars(){
  const R=$('#reader').getBoundingClientRect(),b=$('#bar').getBoundingClientRect(),f=$('#foot').getBoundingClientRect(),st=document.documentElement.style;
  barB=Math.max(0,b.bottom-R.top);footH=Math.max(0,R.bottom-f.top);
  st.setProperty('--bh',barB+'px');st.setProperty('--fh',footH+'px');
}
if('ResizeObserver' in window){const ro=new ResizeObserver(measureBars);ro.observe($('#bar'));ro.observe($('#foot'));}
function centerOn(el,smooth=true){
  const box=$('#text');
  const top=box.scrollTop+el.getBoundingClientRect().top-box.getBoundingClientRect().top-box.clientHeight*0.35;
  box.scrollTo({top,behavior:smooth?'smooth':'auto'});
}
/* ===== scrolling: a comfort band, no per-word movement =====
   Everything is measured inside the VISIBLE area (between the floating bars).
   The text stays still while the cursor moves inside the comfort band (BAND_LO..BAND_HI of the visible height).
   It moves only when the cursor, or the word `lagWords()` ahead of it (the recognizer trails the voice by about a second,
   so we aim at where the voice already is), drifts below the band, or the cursor lands above it or far away.
   Then the current sentence is placed near the top (at LAND), leaving the rest of the screen full of upcoming text.
   It never scrolls "back up" while you read. */
const BAND_LO=.05,BAND_HI=.54,LAND=.2;
function vis(){const box=$('#text');return{box,bt:box.getBoundingClientRect().top+barB,V:Math.max(160,box.clientHeight-barB-footH)}}
const wy=(k,bt)=>words[k].el.getBoundingClientRect().top-bt;   // word top inside the visible area (0 = just under the top bar)
let progUntil=0,inertiaRaf=0;   // progUntil: until when our own smooth scroll may still be running
function followTo(i,smooth=true,force=false){
  if(userBusy()&&!force)return;   // never fight a finger / mouse drag
  const {box,bt,V}=vis();
  const cy=wy(i,bt),ay=wy(Math.min(words.length-1,i+lagWords()),bt);
  if(!force&&cy>V*BAND_LO&&cy<V*BAND_HI&&ay<V*BAND_HI)return;
  // land on the start of the current sentence if it is only a few lines above the cursor (keeps the whole sentence in view)
  const ids=sents[words[i].s];let y=cy;
  if(ids){const sy=wy(ids[0],bt);if(sy<=cy&&cy-sy<V*.22)y=sy;}
  if(smooth)progUntil=performance.now()+700;
  box.scrollTo({top:box.scrollTop+y-V*LAND,behavior:smooth?'smooth':'auto'});
}
const centerPos=(smooth=true)=>followTo(pos,smooth,true);
/* How far ahead of the cursor the scroll aims: about half a second of reading at the measured speaking rate. */
function lagWords(){return Math.max(1,Math.min(5,Math.round((pilot.rate||2.5)*.6)));}
/* The voice moved the cursor. If you had scrolled away by hand and the voice now lands on text you can see
   (you skipped ahead and started reading there), take over again at once: re-center and keep following. */
let lastUser=0,touching=false;
/* is the user busy with the screen right now? A lost touchend must not freeze auto-scroll forever: a touch counts for 1.5 s after its last sign of life. */
const userBusy=()=>(touching&&Date.now()-lastUser<1500)||Date.now()-lastUser<250;
/* The cursor GLIDES over the words in between instead of leaping (the engine often delivers several words at once; four words in
   one frame feel like a jerk, the same four words over ~0.2 s feel like tracking). Steps back and real jumps go at once. */
let glideT=-1,glideTimer=0;
function cancelGlide(){clearTimeout(glideTimer);glideTimer=0;glideT=-1;}
function glideTo(i){
  if(i<=pos||i-pos>12){cancelGlide();setPos(i);return;}
  glideT=i;if(glideTimer)return;
  const step=()=>{
    glideTimer=0;if(glideT<0)return;
    if(glideT-pos<=0){glideT=-1;return;}
    setPos(pos+1);
    const gap=glideT-pos;
    if(gap>0)glideTimer=setTimeout(step,Math.max(16,Math.min(90,Math.round(180/(gap+1)))));else glideT=-1;
  };
  step();
}
function micPos(i){
  if(!follow&&!userBusy()){
    const {bt,V}=vis(),y=wy(i,bt);
    if(y>-V*.05&&y<V*.98){cancelGlide();follow=true;$('#back').classList.remove('show');updChap();setPos(i,true,true);return;}
  }
  glideTo(i);
}
/* The Back to place arrow points to where the current word is: up if it was scrolled off above the reading line. */
function backDir(){
  if(follow||!words.length)return;
  const box=$('#text'),br=box.getBoundingClientRect(),r=words[pos].el.getBoundingClientRect();
  const up=r.top<br.top+box.clientHeight*0.35;
  $('#back use').setAttribute('href',up?'#i-up':'#i-down');
}
function resume(){follow=true;$('#back').classList.remove('show');updChap()}
/* Any manual jump (tap, paragraph buttons) must ignore words the recognizer already heard,
   otherwise the next (often final) result drags the position straight back. */
function manualJump(i){cancelGlide();resume();setPos(i,true,true);markHeard();}
/* ===== 4. paragraph + chapter jumping ===== */
function skipPara(dir){
  if(!words.length)return;
  const skipH=i=>paras[i].h&&!hdSpoken;   // unspoken headings are not stops
  const cp=words[pos].p;
  if(dir<0&&pos>paras[cp].first&&!skipH(cp)){manualJump(paras[cp].first);return;}   // first press: start of this paragraph
  let t=cp+dir;
  while(t>=0&&t<paras.length&&skipH(t))t+=dir;
  if(t>=0&&t<paras.length)manualJump(paras[t].first);
  else if(dir<0){const f=paras.findIndex((_,i)=>!skipH(i));manualJump(paras[Math.max(f,0)].first);}
}

/* ===== 5. speech engines + tracking =====
   Two engines produce the same thing: a list of segments [{words, final}] (finished utterances + one tentative tail).
     - "local"   : js/engine-local.js, Vosk in WebAssembly: offline, ~0.4 s behind your voice, vocabulary limited to the script
     - "browser" : the Web Speech API of Chrome (Google servers): needs internet, ~1 s behind your voice
   onSpeech() feeds the segments to the tracker (js/track.js), which keeps a probability for every position of the script. */
let hearOn=false,lastErrAt=0,tracker=null,pilot=new Pilot(),feed=new SegFeed(),lastList=null,mark={i:0,n:0},engKind='browser',localEng=null,engineGen=0,localFinals=[],localTail=null;
const ENG_LAT={local:.45,browser:1.1};   // seconds each engine trails the voice (used to aim the scroll ahead of the cursor)
const toks=r=>r[0].transcript.split(/\s+/).map(norm).filter(Boolean);
const normWords=t=>t.split(/\s+/).map(norm).filter(Boolean);
function rebuildTracker(){
  const kinds=new Uint8Array(mw.length);   // 2 = paragraph start, 1 = sentence start (where reading likely resumes after a skip)
  for(let k=0;k<mmap.length;k++){const w=words[mmap[k]],pw=k?words[mmap[k-1]]:null;if(!pw||pw.p!==w.p)kinds[k]=2;else if(pw.s!==w.s)kinds[k]=1;}
  tracker=new Tracker(mw,kinds);feed=new SegFeed();pilot=new Pilot();applyAgg();
  tracker.reset(Math.min(mw.length-1,rmap[pos]||0));pilot.anchor(Math.min(mw.length-1,rmap[pos]||0),performance.now()/1000);
}
/* The cursor was moved by hand / search / button: forget what the recognizer heard so far and start from the cursor.
   (Belief is split between "this word was just said" and "this word is about to be said", the next word decides.) */
function markHeard(){
  if(!lastList||!lastList.length)mark={i:0,n:0};
  else{const L=lastList.length-1,r=lastList[L];mark=r.final?{i:L+1,n:0}:{i:L,n:r.words.length,w:r.words.slice()};}
  feed.reset();if(tracker)tracker.reset(rmap[pos]||0);pilot.anchor(rmap[pos]||0,performance.now()/1000);
}
/* status: the sub-line of the sync button; problems (bad=true) also get a readable notice line above the dock */
function status(t,bad){
  const sub=bad?'Needs attention'
    :t==='Auto-sync off'?'Off · tap to start'
    :/^Auto-sync on/.test(t)?'Listening'+(/on-device/.test(t)?' · on-device':engKind==='browser'?' · browser':'')
    :/^Downloading speech model (\d+%)/.test(t)?'Model '+t.match(/(\d+%)/)[1]
    :t.replace('…','...');
  $('#stxt').textContent=sub;
  const n=$('#notice');if(bad){n.textContent=t;n.hidden=false;}else n.hidden=true;
}
/* live meter: five bars follow the real voice level (on-device engine) or idle-wave (browser engine, no level signal) */
const barEls=[...document.querySelectorAll('#mic .bars i')];
let lvl=0,lvlT=0,barsRaf=0;
function barsTick(){
  lvl+=(lvlT-lvl)*.4;lvlT*=.82;
  const a=Math.min(1,lvl*9),now=performance.now();
  for(let k=0;k<barEls.length;k++){const sh=[.6,.85,1,.85,.6][k];barEls[k].style.height=(4+Math.min(1,a*sh*(.7+.3*Math.sin(now/85+k*1.9)))*26).toFixed(1)+'px';}
  barsRaf=requestAnimationFrame(barsTick);
}
function live(on){
  $('#reader').classList.toggle('live',on);$('#mic').classList.toggle('on',on);
  cancelAnimationFrame(barsRaf);
  const lv=on&&engKind==='local';
  $('#mic').classList.toggle('nolevel',on&&!lv);
  if(lv){lvl=lvlT=0;barsTick();}else barEls.forEach(e=>e.style.height='');
}
/* script indices of the first/last words on screen (the tracker favors jumps to what you can see) */
function visRange(){
  const {bt,V}=vis();
  const firstBelow=line=>{let a=0,b=words.length-1;while(a<b){const m=(a+b)>>1;if(words[m].el.getBoundingClientRect().top<line)a=m+1;else b=m;}return a;};
  return [rmap[firstBelow(bt)],rmap[firstBelow(bt+V)]];
}
function onSpeech(list){
  lastList=list;
  if(hearOn){const l=list.length?list[list.length-1].words:[];$('#heard').textContent=l.length?'… '+l.slice(-9).join(' '):'';}
  if(sOpen||!tracker)return;   // while searching, the voice does not move the cursor
  // The mark says "ignore the first n words of this phrase: they were said before the cursor was moved by hand". It only holds while
  // the phrase still STARTS with those words. If the engine restarted or rewrote the phrase (shorter, or different), those words are
  // gone and every new word counts; otherwise the new words were cut away until the phrase outgrew n (that looked like a freeze).
  if(mark.n&&mark.w){
    const cur=list[mark.i]?list[mark.i].words:null;
    let same=false;
    if(cur&&cur.length>=mark.n){let ok=0;for(let k=0;k<mark.n;k++)if(fuzzyEq(cur[k],mark.w[k]))ok++;same=ok>=mark.n*.7;}
    if(!same)mark={i:mark.i,n:0};
  }
  const segs=[];
  for(let i=mark.i;i<list.length;i++){let w=list[i].words;if(i===mark.i&&mark.n)w=w.slice(mark.n);segs.push({words:w,final:list[i].final});}
  const {commit,tail,nw}=feed.update(segs);
  for(const c of commit)tracker.commit(c);
  pilot.addHeard(nw);
  if(!follow&&userBusy())return;   // the screen is still moving: committed words are kept, positioning waits
  if(!commit.length&&!tail.length)return;
  if(follow)tracker.setView(-1,-1);else{const v=visRange();tracker.setView(v[0],v[1]);}
  const e=tracker.step(tail,false,pilot.est,pilot.contMax(performance.now()/1000));
  dlog({k:'seg',segs:list.length,fin:list.filter(x=>x.final).length,nw,tail:tail.slice(-8).join(' ')});
  applyEstimate(e);
}
/* What the cursor does with the tracker's estimate is decided by the Pilot (js/track.js, covered by tests/sim2.js):
   continuation of reading, correction of its own overshoot, jumps (sensitivity slider; the fast-forward button forbids them),
   and the cursor lead (makes up for the recognition delay). */
const aggEps=()=>.002*Math.pow(30,agg/100);        // jump prior: 0.002 (careful) .. 0.06 (eager)
function applyAgg(){if(tracker)tracker.jump=jumpsOn?aggEps():.0004;}
function applyEstimate(e){
  const cur=rmap[pos]||0,now=performance.now()/1000;
  const tgt=pilot.decide(e,cur,{n:mw.length,agg,jumpsOn,leadWords:leadW},now);
  dlog({k:'est',pos:e.pos,conf:+e.conf.toFixed(2),loc:+(e.local||0).toFixed(2),lp:e.locPos,lc:+(e.locConf||0).toFixed(2),fit:+(e.fit||0).toFixed(2),est:pilot.est,cur,tgt,heard:pilot.heard,lead:leadW});
  if(tgt>=0){pilot.moved(cur,tgt,now);micPos(mmap[tgt]);}
  if(!jumpsOn&&pilot.lostPos>=0&&now-pilot.lostAt<1.2)showLost();
}
/* jumps are off, but you are clearly somewhere else: offer to go there (a tap), never do it silently */
let lostT=0;
function showLost(){$('#lost').classList.add('show');clearTimeout(lostT);lostT=setTimeout(()=>$('#lost').classList.remove('show'),6000);}
$('#lost').onclick=()=>{const l=pilot.lostPos;$('#lost').classList.remove('show');if(l>=0&&mmap[l]!==undefined)manualJump(mmap[l]);};
/* diagnostics: a small ring buffer you can copy from Settings and send along with a bug report */
const DLOG=[];
function dlog(o){if(!dbgOn)return;o.t=+(performance.now()/1000).toFixed(2);o.eng=engKind;DLOG.push(JSON.stringify(o));if(DLOG.length>500)DLOG.shift();}

/* --- engine 1: the browser's Web Speech API --- */
/* Chrome ends the session now and then (silence, a phrase, a hiccup). Restart it until it really runs again: a single failed
   start() used to leave the cursor frozen while the app still said "Listening". After an error, retry slowly. */
let lastEvt=0,lastResultAt=0,speechOn=0,kicks=0;
function restartBrowser(r,n){
  if(!(wantRec&&rec===r))return;
  const delay=n?Math.min(2000,250*n):(Date.now()-lastErrAt<6000?2500:40);
  setTimeout(()=>{
    if(!(wantRec&&rec===r))return;
    try{r.start();lastEvt=Date.now();if(!lastErrAt)status('Auto-sync on');}
    catch(e){
      if(e&&e.name==='InvalidStateError')return;           // it is already running
      if(n<12)restartBrowser(r,n+1);
      else{try{r.abort()}catch(_){}rec=null;startBrowser();}   // give up on this object, make a fresh recognizer
    }
  },delay);
}
/* Watchdog. A browser session can silently stop delivering (that looked like "the cursor does not listen for half a minute").
   It is revived when speech was detected but no result came for 5 s, or when nothing at all happened for 12 s
   (Chrome itself ends a silent session after ~8 s, so a quiet but healthy session still produces events).
   If reviving the same recognizer does not help twice in a row, a brand-new recognizer is created. */
setInterval(()=>{
  if(!(wantRec&&engKind==='browser'&&rec&&!lastErrAt))return;
  const now=Date.now();
  const stalled=(speechOn&&now-Math.max(speechOn,lastResultAt)>5000)||now-lastEvt>12000;
  if(!stalled)return;
  lastEvt=now;speechOn=0;kicks++;dlog({k:'watchdog',kicks});
  const r=rec;
  try{r.abort()}catch(_){}
  if(kicks>=2){kicks=0;setTimeout(()=>{if(wantRec&&engKind==='browser'&&rec===r){try{r.abort()}catch(_){}rec=null;startBrowser();}},600);}
},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&wantRec&&engKind==='browser'&&rec){dlog({k:'visible'});try{rec.abort()}catch(_){}}});
function startBrowser(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){status('Speech recognition is not available in this browser',true);wantRec=false;return false;}
  engKind='browser';
  const r=new SR();rec=r;
  r.lang=spokenLang();r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  r.onstart=()=>{if(rec===r){lastList=null;mark={i:0,n:0};feed.reset();lastEvt=Date.now();dlog({k:'start'});}};
  r.onaudiostart=r.onsoundstart=()=>{lastEvt=Date.now()};
  r.onspeechstart=()=>{lastEvt=speechOn=Date.now();};
  r.onspeechend=()=>{speechOn=0;};
  r.onresult=e=>{if(rec!==r)return;lastEvt=lastResultAt=Date.now();kicks=0;if(lastErrAt){lastErrAt=0;status('Auto-sync on');}onSpeech(Array.from(e.results,x=>({words:toks(x),final:x.isFinal})));};
  r.onerror=e=>{
    if(rec!==r)return;
    dlog({k:'error',e:e.error});
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      wantRec=false;live(false);
      status('Microphone blocked: allow it in the site settings (lock icon → Permissions)',true);
    }else if(e.error==='network'){lastErrAt=Date.now();status('The browser engine cannot reach the speech service (no internet, or blocked here). Use the on-device engine over https.',true);}
    else if(e.error==='audio-capture'){lastErrAt=Date.now();status('No microphone found',true);}
    else if(e.error!=='no-speech'&&e.error!=='aborted'){lastErrAt=Date.now();status('Speech error: '+e.error,true);}
  };
  r.onend=()=>{
    if(rec!==r)return;
    dlog({k:'end'});
    lastList=null;mark={i:0,n:0};feed.reset();
    restartBrowser(r,0);
  };
  wantRec=true;
  try{r.start();}catch(_){}
  live(true);status('Auto-sync on');
  return true;
}

/* --- engine 2: on-device (Vosk) --- */
const localSupported=()=>!!(window.WebAssembly&&navigator.mediaDevices&&window.AudioContext&&window.caches&&window.Worker);
const modelExistsCache={};
async function localAvailable(lang){
  const url=localModelFor(lang);if(!url||!localSupported())return false;
  if(url in modelExistsCache)return modelExistsCache[url];
  let ok=false;
  try{
    const c=await caches.open('prompter-models');
    if(await c.match(url))ok=true;
    else{const r=await fetch(url,{method:'HEAD'});ok=r.ok&&!/html/.test(r.headers.get('content-type')||'');}
  }catch(_){}
  if(ok)modelExistsCache[url]=true;   // a failed check is retried on the next start
  return ok;
}
function localWhy(lang){
  const url=localModelFor(lang);
  if(!url)return 'no on-device model for this language';
  if(!window.isSecureContext)return 'on-device needs https or localhost';
  if(!localSupported())return 'this browser lacks WebAssembly / AudioWorklet';
  return 'model file not found on this site ('+url+')';
}
/* every word of the script, lowercase, apostrophes kept: the recognizer is restricted to these words */
function grammarWords(){
  const out=[];
  for(const w of words){
    const t=w.el.firstChild.textContent.toLowerCase().replace(/[’‘`]/g,"'").replace(/[^\p{L}']+/gu,' ');
    for(const x of t.split(' ')){const y=x.replace(/^'+|'+$/g,'');if(y)out.push(y);}
  }
  return out;
}
const pushLocal=()=>onSpeech(localTail?[...localFinals,localTail]:localFinals.slice());
async function startLocal(lang,gen){
  engKind='local';live(false);status('Loading speech model…');
  const eng=new LocalEngine();localEng=eng;localFinals=[];localTail=null;
  await eng.start(lang,grammarWords(),{
    onProgress:p=>{if(gen!==engineGen)return;status(p<1?'Downloading speech model '+Math.round(p*100)+'%':'Preparing the speech model (the first time can take a minute)…');},
    onPartial:t=>{if(gen!==engineGen)return;localTail={words:normWords(t),final:false};pushLocal();},
    onFinal:t=>{if(gen!==engineGen)return;if(t)localFinals.push({words:normWords(t),final:true});localTail=null;pushLocal();},
    onLevel:v=>{if(v>lvlT)lvlT=v;},
    onError:m=>console.warn('on-device engine:',m)
  });
  if(gen!==engineGen){eng.stop();return;}
  lastList=null;mark={i:0,n:0};feed.reset();
  live(true);status('Auto-sync on · on-device');
}

/* --- start / stop (auto = on-device when a model exists for the language, else the browser engine) --- */
async function startRec(){
  wantRec=true;const gen=++engineGen,pref=$('#eng').value,lang=spokenLang();
  if(pref!=='browser'&&await localAvailable(lang)){
    if(gen!==engineGen||!wantRec)return;
    try{await startLocal(lang,gen);return;}
    catch(e){
      if(gen!==engineGen)return;
      console.warn(e);try{localEng&&localEng.stop();}catch(_){}localEng=null;
      if(e&&(e.name==='NotAllowedError'||e.name==='SecurityError')){wantRec=false;live(false);status('Microphone blocked: allow it in the site settings',true);return;}
      dlog({k:'local-failed',e:String((e&&(e.message||e.name))||e)});
      toast('On-device engine failed ('+((e&&(e.message||e.name))||'unknown')+'), using the browser engine',7000);
    }
  }else if(pref!=='browser')toast('Using the browser engine: '+localWhy(lang),5000);
  if(gen!==engineGen||!wantRec)return;
  startBrowser();
}
function stopRec(){
  wantRec=false;engineGen++;
  const r=rec;rec=null;try{r&&r.abort()}catch(_){}
  if(localEng){try{localEng.stop()}catch(_){}localEng=null;}
  live(false);status('Auto-sync off');
}

async function wake(){
  if(!reading||!('wakeLock' in navigator))return;
  try{lock=await navigator.wakeLock.request('screen')}catch(_){}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')wake()});

let toastT=0;
function toast(t,ms=900){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),ms)}
function setFont(v){
  fs=Math.max(16,Math.min(72,v));
  document.documentElement.style.setProperty('--fs',fs+'px');
  try{localStorage.setItem('sf_fs',fs)}catch(e){}
  $('#fsv').textContent=fs+' px';
  // keep the current word in place after the text reflows
  if(words.length){resume();requestAnimationFrame(()=>{drawSent();centerPos(false)});}
}

$('#mic').onclick=()=>{
  if(wantRec)stopRec();
  else{startRec();resume();centerPos();}
};
$('#next').onclick=()=>skipPara(1);
$('#prev').onclick=()=>skipPara(-1);
$('#back').onclick=()=>{resume();centerPos()};
$('#text').addEventListener('touchstart',()=>{touching=true;lastUser=Date.now();userGrab();},{passive:true});
const untouch=()=>{touching=false;lastUser=Date.now()};
$('#text').addEventListener('touchend',untouch,{passive:true});
$('#text').addEventListener('touchcancel',untouch,{passive:true});
const pauseFollow=()=>{lastUser=Date.now();if(!follow)return;follow=false;backDir();$('#back').classList.add('show')};
$('#text').addEventListener('scroll',()=>{if(!follow)lastUser=Date.now();backDir();},{passive:true});
$('#text').addEventListener('scroll',pinByScroll,{passive:true});
$('#text').addEventListener('touchmove',pauseFollow,{passive:true});
$('#text').addEventListener('wheel',()=>{userGrab();pauseFollow();},{passive:true});

/* The user takes over: stop OUR smooth scroll (it used to fight the finger and make the screen twitch) and any drag inertia.
   Only our own scroll is cancelled, so the browser's own smooth wheel scrolling is left alone. */
function userGrab(){
  cancelAnimationFrame(inertiaRaf);
  if(performance.now()<progUntil){progUntil=0;const b=$('#text');b.scrollTo({top:b.scrollTop,behavior:'auto'});}
}
/* Grab the text with the mouse and drag it (touch scrolls natively); it keeps gliding a little after you let go. */
{
  const box=$('#text');let d=null,moved=false;
  box.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch'||e.button!==0)return;
    userGrab();d={id:e.pointerId,y:e.clientY,top:box.scrollTop,t:performance.now(),ly:e.clientY,v:0,on:false};
  });
  addEventListener('pointermove',e=>{
    if(!d||e.pointerId!==d.id)return;
    const dy=e.clientY-d.y;
    if(!d.on){
      if(Math.abs(dy)<5)return;
      d.on=true;moved=true;box.classList.add('dragging');touching=true;lastUser=Date.now();pauseFollow();
      try{box.setPointerCapture(e.pointerId)}catch(_){}
    }
    box.scrollTop=d.top-dy;
    const now=performance.now(),dt=Math.max(1,now-d.t);
    d.v=.7*d.v+.3*((d.ly-e.clientY)/dt);d.ly=e.clientY;d.t=now;
  });
  const end=e=>{
    if(!d||(e&&e.pointerId!==d.id))return;
    const g=d;d=null;
    if(!g.on)return;
    box.classList.remove('dragging');untouch();
    let v=performance.now()-g.t>90?0:g.v;   // px per ms; no glide if you held still before letting go
    if(Math.abs(v)>.1){
      let last=performance.now();
      const step=now=>{const dt=Math.min(40,now-last);last=now;v*=Math.pow(.94,dt/16);box.scrollTop+=v*dt;if(Math.abs(v)>.03)inertiaRaf=requestAnimationFrame(step);};
      inertiaRaf=requestAnimationFrame(step);
    }
    setTimeout(()=>{moved=false},0);
  };
  addEventListener('pointerup',end);addEventListener('pointercancel',end);
  box.addEventListener('click',e=>{if(moved){e.stopPropagation();e.preventDefault();}moved=false;},true);   // a drag is not a tap on a word
}
$('#fp').onclick=()=>setFont(fs+2);
$('#fm').onclick=()=>setFont(fs-2);
$('#edit').onclick=()=>{
  closeSearch();stopRec();reading=false;
  try{lock&&lock.release()}catch(_){}lock=null;
  $('#reader').style.display='none';$('#setup').style.display='flex';
};
$('#go').onclick=()=>{
  const t=$('#src').value.trim();if(!t)return;
  try{localStorage.setItem('sf_t',t);localStorage.setItem('sf_l2',$('#lang').value);localStorage.setItem('sf_md',mdOn?'1':'0');localStorage.setItem('sf_eng',$('#eng').value)}catch(e){}
  closeSearch();build(t,mdOn);curW=-1;pos=0;resume();
  $('#setup').style.display='none';$('#reader').style.display='block';
  if(!words.length){$('#reader').style.display='none';$('#setup').style.display='flex';return;}
  $('#text').scrollTop=0;setPos(firstSpeakable(),false,true);
  reading=true;wake();
  // Start also turns auto-sync on (the tap counts as the user gesture the mic needs)
  stopRec();markHeard();startRec();
};

/* ===== chapters (only for Markdown with headings) ===== */
let curCh=-2;
function chapIdx(i){let lo=0,hi=chapters.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(chapters[m].first<=i){r=m;lo=m+1}else hi=m-1}return r}
const firstSpeakable=()=>mmap.length?mmap[0]:0;   // first word that is actually said (skips unspoken leading headings)
/* where reading starts in a chapter: its first word, or the first word after the heading if headings are not spoken */
const chStart=c=>hdSpoken?chapters[c].first:Math.min(chapters[c].end+1,words.length-1);
/* "pinned message": title of the chapter at the cursor (or at the reading line while you scroll by hand) */
function showChap(c){
  if(c===curCh)return;curCh=c;
  const pin=$('#pin');
  $('#cnum').textContent=c>=0?(c+1)+'/'+chapters.length:'';
  if(c<0){pin.classList.add('empty');return;}
  let par='';
  for(let k=c-1;k>=0;k--)if(chapters[k].level<chapters[c].level){par=chapters[k].title;break;}
  $('#ppar').textContent=par;$('#psep').hidden=!par;$('#pcur').textContent=chapters[c].title;
  pin.classList.remove('empty','swap');void pin.offsetWidth;pin.classList.add('swap');
}
function updChap(){if(chapters.length)showChap(chapIdx(pos));}
/* while the text is scrolled by hand the pin follows what is on screen, not the cursor */
let pinRaf=0;
function pinByScroll(){
  if(follow||!chapters.length||pinRaf)return;
  pinRaf=requestAnimationFrame(()=>{
    pinRaf=0;if(follow)return;
    const box=$('#text'),y=box.scrollTop+box.clientHeight*.35;
    let lo=0,hi=paras.length-1,b=0;
    while(lo<=hi){const m=(lo+hi)>>1;if(paras[m].el.offsetTop<=y){b=m;lo=m+1}else hi=m-1}
    showChap(chapIdx(paras[b].first));
  });
}
function skipChap(dir){
  if(!chapters.length)return;
  const c=chapIdx(pos);
  let t=dir>0?c+1:((c>=0&&pos>chStart(c))?c:c-1);   // first "back" press returns to the start of this chapter
  if(t>=chapters.length){toast('Last chapter');return;}
  manualJump(t<0?firstSpeakable():chStart(t));
}
/* heading toggle: does sync expect headings to be spoken? (they always stay visible and pinned) */
function applyHd(){
  const b=$('#hbtn');
  b.setAttribute('aria-pressed',hdSpoken);
  b.setAttribute('aria-label',hdSpoken?'Sync includes headings':'Sync skips headings');
  ({mw,mmap,rmap}=matchIndex(wn,words.map(w=>w.h&&!hdSpoken)));
  paras.forEach(p=>p.el.classList.toggle('nospeak',!!p.h&&!hdSpoken));
  rebuildTracker();markHeard();updateProg(pos);
}
$('#hbtn').onclick=()=>{
  hdSpoken=!hdSpoken;try{localStorage.setItem('sf_hd',hdSpoken?'1':'0')}catch(e){}
  applyHd();toast(hdSpoken?'Sync: headings included':'Sync: headings skipped');
};
/* ===== settings sheet + jump toggle ===== */
const AGG_NAMES=['Very careful','Careful','Balanced','Eager','Very eager'];
/* 11 positions: 2 + 2 + 3 (Balanced sits in the middle) + 2 + 2 */
const aggName=v=>{const i=Math.round(v/10);return AGG_NAMES[i<=1?0:i<=3?1:i<=6?2:i<=8?3:4];};
function openSettings(){closeOutline();closeSearch();$('#settings').classList.add('show');}
function closeSettings(){$('#settings').classList.remove('show');}
$('#setbtn').onclick=()=>$('#settings').classList.contains('show')?closeSettings():openSettings();
$('#settings').addEventListener('click',e=>{if(e.target.id==='settings')closeSettings()});
function applyJumps(){
  const b=$('#jbtn');b.setAttribute('aria-pressed',jumpsOn);
  b.setAttribute('aria-label',jumpsOn?'Jumps allowed':'Jumps off');
  applyAgg();
}
$('#jbtn').onclick=()=>{
  jumpsOn=!jumpsOn;try{localStorage.setItem('sf_jump',jumpsOn?'1':'0')}catch(e){}
  applyJumps();pilot.reset();toast(jumpsOn?'Jumps on: the cursor follows you if you skip':'Jumps off: the cursor only moves forward step by step',2200);
};
const LEAD_NAMES=['Off','1 word','2 words','3 words'];
makeSlider($('#lead'),{min:0,max:3,step:1,value:leadW,onChange:v=>{leadW=v;$('#leadv').textContent=LEAD_NAMES[v];try{localStorage.setItem('sf_leadw',leadW)}catch(_){}}});
$('#leadv').textContent=LEAD_NAMES[leadW];
/* sentence mode: no word highlight, whole sentences are followed */
function applySent(){$('#reader').classList.toggle('sentmode',sentOn);$('#sentsw').setAttribute('aria-pressed',sentOn);}
$('#sentsw').onclick=()=>{sentOn=!sentOn;try{localStorage.setItem('sf_sent',sentOn?'1':'0')}catch(_){}applySent();};
applySent();
$('#hearsw').setAttribute('aria-pressed',hearOn);$('#heard').hidden=!hearOn;
$('#hearsw').onclick=()=>{hearOn=!hearOn;$('#hearsw').setAttribute('aria-pressed',hearOn);$('#heard').hidden=!hearOn;if(!hearOn)$('#heard').textContent='';try{localStorage.setItem('sf_hear',hearOn?'1':'0')}catch(_){}};
$('#dbg').setAttribute('aria-pressed',dbgOn);
$('#dbg').onclick=()=>{dbgOn=!dbgOn;$('#dbg').setAttribute('aria-pressed',dbgOn);try{localStorage.setItem('sf_dbg',dbgOn?'1':'0')}catch(_){}toast(dbgOn?'Logging on':'Logging off');};
$('#dbgcopy').onclick=async()=>{
  const txt=DLOG.join('\n')||'(log is empty: switch logging on, read for a while, then copy)';
  try{await navigator.clipboard.writeText(txt);toast('Copied '+DLOG.length+' lines');}
  catch(_){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('Copied '+DLOG.length+' lines');}catch(__){toast('Could not copy');}ta.remove();}
};
makeSlider($('#agg'),{min:0,max:10,step:1,value:Math.round(agg/10),onChange:v=>{agg=v*10;$('#aggv').textContent=aggName(agg);applyAgg();try{localStorage.setItem('sf_agg',agg)}catch(_){}}});
$('#aggv').textContent=aggName(agg);
/* text column width while reading (computer screens; the row is hidden on phones) */
function applyCol(){document.documentElement.style.setProperty('--col',col+'px');$('#colv').textContent=col+' px';}
makeSlider($('#col'),{min:480,max:1400,step:20,value:col,onChange:v=>{col=v;applyCol();try{localStorage.setItem('sf_col',col)}catch(_){}
  if(reading)requestAnimationFrame(()=>{drawSent();if(follow&&words.length)centerPos(false);});}});
applyCol();
sheetDrag($('#settings'),closeSettings);sheetDrag($('#outline'),closeOutline);   // pull a sheet down to close it
$('#fsv').textContent=fs+' px';
$('#ver').textContent=APP_VERSION;
applyJumps();
function openOutline(){
  const sh=$('#osheet'),c=chapIdx(pos),mn=Math.min(...chapters.map(x=>x.level));sh.innerHTML='';
  chapters.forEach((ch,i)=>{
    const b=document.createElement('button');
    b.className=(i===c?'now ':'')+(ch.level>mn?'sub':'');b.style.setProperty('--l',ch.level-mn);
    const s=document.createElement('span');s.textContent=ch.title;b.appendChild(s);
    b.onclick=()=>{closeOutline();manualJump(chStart(i))};
    sh.appendChild(b);
  });
  $('#outline').classList.add('show');
  const now=sh.querySelector('.now');if(now)now.scrollIntoView({block:'center'});
}
function closeOutline(){$('#outline').classList.remove('show')}
$('#outx').onclick=()=>closeOutline();
$('#setx').onclick=()=>closeSettings();
$('#cprev').onclick=()=>skipChap(-1);
$('#cnext').onclick=()=>skipChap(1);
$('#ctitle').onclick=openOutline;
$('#pin').onclick=openOutline;
$('#outline').addEventListener('click',e=>{if(e.target.id==='outline')closeOutline()});

/* ===== 6. search (in-app Ctrl+F) ===== */
let sOpen=false,hits=[],hi=-1,hitEls=[],selEls=[],sT=0;
function openSearch(){
  if(!reading)return;
  closeOutline();sOpen=true;$('#reader').classList.add('searching');resume();
  const q=$('#sq');q.focus();q.select();if(q.value)runSearch();
}
function closeSearch(){
  if(!sOpen)return;
  sOpen=false;clearHits();$('#reader').classList.remove('searching');$('#sq').blur();markHeard();
}
function clearHits(){
  hitEls.forEach(e=>e.classList.remove('hit','sel'));hitEls=[];selEls=[];
}
function runSearch(){
  clearHits();
  const q=$('#sq').value;
  hits=q.trim()?searchFind(q,wf):[];
  hits.forEach(h=>h.words.forEach(i=>{const e=words[i].el;e.classList.add('hit');hitEls.push(e);}));
  if(!hits.length){hi=-1;$('#scount').textContent=q.trim()?'0':'';return;}
  gotoHit(searchPick(hits,pos));
}
function gotoHit(n){
  if(!hits.length)return;
  hi=(n+hits.length)%hits.length;
  selEls.forEach(e=>e.classList.remove('sel'));selEls=[];
  hits[hi].words.forEach(i=>{const e=words[i].el;e.classList.add('sel');selEls.push(e);});
  $('#scount').textContent=(hi+1)+'/'+hits.length;
  manualJump(hits[hi].idx);   // the match becomes the reading position, so closing search leaves you there
}
$('#sbtn').onclick=()=>sOpen?closeSearch():openSearch();
$('#sclose').onclick=closeSearch;
$('#snext').onclick=()=>gotoHit(hi+1);
$('#sprev').onclick=()=>gotoHit(hi-1);
$('#sq').addEventListener('input',()=>{clearTimeout(sT);sT=setTimeout(runSearch,140)});
$('#sq').addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();clearTimeout(sT);if(hi<0)runSearch();else gotoHit(e.shiftKey?hi-1:hi+1);}
});
addEventListener('keydown',e=>{
  if(!reading)return;
  const k=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&k==='f'){e.preventDefault();openSearch();}
  else if(k==='escape'){if($('#settings').classList.contains('show'))closeSettings();else if($('#outline').classList.contains('show'))closeOutline();else closeSearch();}
  else if(sOpen&&(k==='f3'||((e.ctrlKey||e.metaKey)&&k==='g'))){e.preventDefault();gotoHit(e.shiftKey?hi-1:hi+1);}
});

/* ===== 7. service worker ===== */
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
