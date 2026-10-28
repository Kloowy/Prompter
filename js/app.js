const $=s=>document.querySelector(s);
/* app.js: UI, reader, microphone glue, search glue, chapters, file loading.
   Brain parts live elsewhere: js/match.js (speech -> position), js/markdown.js (parser), js/search.js (fuzzy find).
   Sections: 1 state/setup  2 build text  3 position + highlight  4 paragraphs/chapters  5 microphone  6 search  7 buttons */
/* ===== 1. state + setup screen ===== */
let words=[],wn=[],wf=[],paras=[],chapters=[],sents={},pos=0,follow=true,rec=null,wantRec=false,lock=null,reading=false,mdOn=false,mdTouched=false,hdSpoken=false,mw=[],mmap=[],rmap=[];
let fs=Math.round(Math.min(40,Math.max(24,innerWidth/13)));
try{const v=+localStorage.getItem('sf_fs');if(v>=16&&v<=72)fs=v;}catch(e){}
document.documentElement.style.setProperty('--fs',fs+'px');

try{const t=localStorage.getItem('sf_t');if(t)$('#src').value=t;const l=localStorage.getItem('sf_l2');if(l)$('#lang').value=l;hdSpoken=localStorage.getItem('sf_hd')==='1';const eg=localStorage.getItem('sf_eng');if(eg&&$('#eng'))$('#eng').value=eg;const m=localStorage.getItem('sf_md');if(m!==null){mdOn=m==='1';mdTouched=true;}}catch(e){}

const langSel=$('#lang'),autoOpt=langSel.querySelector('option[value="auto"]');
function showDetected(){
  const d=detectLang($('#src').value),o=d&&langSel.querySelector('option[value="'+d+'"]');
  autoOpt.textContent=o?'Auto-detect · '+o.textContent.replace(/ \(US\)$/,''):'Auto-detect';
}
function spokenLang(){
  if(langSel.value!=='auto')return langSel.value;
  return detectLang($('#src').value)||'en-US';
}
function setMd(on){mdOn=on;$('#mdt').setAttribute('aria-pressed',on)}
let detT=0;
$('#src').addEventListener('input',()=>{clearTimeout(detT);detT=setTimeout(()=>{showDetected();if(!mdTouched)setMd(mdDetect($('#src').value))},300)});
$('#mdt').onclick=()=>{mdTouched=true;setMd(!mdOn)};
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
  words=[];wn=[];wf=[];paras=[];chapters=[];sents={};resetSimCache();
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
  if(newSent)drawSent();
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
function followTo(i,smooth=true,force=false){
  const {box,bt,V}=vis();
  const cy=wy(i,bt),ay=wy(Math.min(words.length-1,i+lagWords()),bt);
  if(!force&&cy>V*BAND_LO&&cy<V*BAND_HI&&ay<V*BAND_HI)return;
  // land on the start of the current sentence if it is only a few lines above the cursor (keeps the whole sentence in view)
  const ids=sents[words[i].s];let y=cy;
  if(ids){const sy=wy(ids[0],bt);if(sy<=cy&&cy-sy<V*.22)y=sy;}
  box.scrollTo({top:box.scrollTop+y-V*LAND,behavior:smooth?'smooth':'auto'});
}
const centerPos=(smooth=true)=>followTo(pos,smooth,true);
/* How many words the voice is ahead of the cursor: speaking rate (words/s over the last seconds) x ~1.1 s of recognizer delay. */
let moveLog=[];
function noteMove(i){
  const t=performance.now(),d=i-pos;
  if(d<1||d>12){moveLog=[];return;}   // jumps and backward steps say nothing about speaking speed
  moveLog.push([t,i]);while(moveLog.length&&t-moveLog[0][0]>5000)moveLog.shift();
}
function lagWords(){
  const lat=ENG_LAT[engKind]||1.1,base=Math.max(1,Math.round(3*lat/1.1));
  if(moveLog.length<3)return base;
  const a=moveLog[0],b=moveLog[moveLog.length-1],dt=(b[0]-a[0])/1000;
  if(dt<1)return base;
  return Math.max(1,Math.min(8,Math.round((b[1]-a[1])/dt*lat)));
}
/* The voice moved the cursor. If you had scrolled away by hand and the voice now lands on text you can see
   (you skipped ahead and started reading there), take over again at once: re-center and keep following. */
let lastUser=0,touching=false;
function micPos(i){
  noteMove(i);
  if(!follow&&!touching&&Date.now()-lastUser>300){
    const {bt,V}=vis(),y=wy(i,bt);
    if(y>-V*.05&&y<V*.98){follow=true;$('#back').classList.remove('show');updChap();setPos(i,true,true);return;}
  }
  setPos(i);
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
function manualJump(i){resume();setPos(i,true,true);markHeard();}
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
let tracker=null,feed=new SegFeed(),lastList=null,mark={i:0,n:0},engKind='browser',localEng=null,engineGen=0,localFinals=[],localTail=null;
const ENG_LAT={local:.45,browser:1.1};   // seconds each engine trails the voice (used to aim the scroll ahead of the cursor)
const toks=r=>r[0].transcript.split(/\s+/).map(norm).filter(Boolean);
const normWords=t=>t.split(/\s+/).map(norm).filter(Boolean);
function rebuildTracker(){
  const kinds=new Uint8Array(mw.length);   // 2 = paragraph start, 1 = sentence start (where reading likely resumes after a skip)
  for(let k=0;k<mmap.length;k++){const w=words[mmap[k]],pw=k?words[mmap[k-1]]:null;if(!pw||pw.p!==w.p)kinds[k]=2;else if(pw.s!==w.s)kinds[k]=1;}
  tracker=new Tracker(mw,kinds);feed=new SegFeed();
  tracker.reset(Math.min(mw.length-1,rmap[pos]||0));
}
/* The cursor was moved by hand / search / button: forget what the recognizer heard so far and start from the cursor.
   (Belief is split between "this word was just said" and "this word is about to be said", the next word decides.) */
function markHeard(){
  if(!lastList||!lastList.length)mark={i:0,n:0};
  else{const L=lastList.length-1,r=lastList[L];mark=r.final?{i:L+1,n:0}:{i:L,n:r.words.length};}
  feed.reset();if(tracker)tracker.reset(rmap[pos]||0);
}
function status(t){$('#stxt').textContent=t}
function live(on){$('#reader').classList.toggle('live',on);$('#mic').classList.toggle('on',on)}
/* script indices of the first/last words on screen (the tracker favors jumps to what you can see) */
function visRange(){
  const {bt,V}=vis();
  const firstBelow=line=>{let a=0,b=words.length-1;while(a<b){const m=(a+b)>>1;if(words[m].el.getBoundingClientRect().top<line)a=m+1;else b=m;}return a;};
  return [rmap[firstBelow(bt)],rmap[firstBelow(bt+V)]];
}
function onSpeech(list){
  lastList=list;
  if(sOpen||!tracker)return;   // while searching, the voice does not move the cursor
  const segs=[];
  for(let i=mark.i;i<list.length;i++){let w=list[i].words;if(i===mark.i&&mark.n)w=w.slice(mark.n);segs.push({words:w,final:list[i].final});}
  const {commit,tail}=feed.update(segs);
  for(const c of commit)tracker.commit(c);
  if(!follow&&(touching||Date.now()-lastUser<250))return;   // the screen is still moving: committed words are kept, positioning waits
  if(!commit.length&&!tail.length)return;
  if(follow)tracker.setView(-1,-1);else{const v=visRange();tracker.setView(v[0],v[1]);}
  applyEstimate(tracker.step(tail,false));
}
/* move the cursor only when the tracker is sure: small forward steps need little confidence, big jumps and any step back need more */
function applyEstimate(e){
  if(e.pos<0)return;
  const d=e.pos-(rmap[pos]||0);if(!d)return;
  if(d<0&&d>=-4)return;   // a step back of a few words is recognizer jitter (an early guess retracted): the voice catches up by itself
  const need=d<0?TRK.ACC_BACK:(d<=12?TRK.ACC_NEAR:TRK.ACC_FAR);
  if(e.conf>=need)micPos(mmap[e.pos]);
}

/* --- engine 1: the browser's Web Speech API --- */
function startBrowser(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){status('Speech recognition is not available in this browser');wantRec=false;return false;}
  engKind='browser';
  const r=new SR();rec=r;
  r.lang=spokenLang();r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  r.onstart=()=>{if(rec===r){lastList=null;mark={i:0,n:0};feed.reset();}};
  r.onresult=e=>{if(rec===r)onSpeech(Array.from(e.results,x=>({words:toks(x),final:x.isFinal})));};
  r.onerror=e=>{
    if(rec!==r)return;
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      wantRec=false;live(false);
      status('Microphone blocked: allow it in site settings (lock icon → Permissions)');
    }else if(e.error==='network')status('No internet: the browser engine needs a connection');
    else if(e.error==='audio-capture')status('No microphone found');
    else if(e.error!=='no-speech'&&e.error!=='aborted')status('Error: '+e.error);
  };
  r.onend=()=>{
    if(rec!==r)return;
    lastList=null;mark={i:0,n:0};feed.reset();
    if(wantRec)setTimeout(()=>{if(wantRec&&rec===r){try{r.start();status('Auto-sync on')}catch(_){}}},40);
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
  return modelExistsCache[url]=ok;
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
    onProgress:p=>{if(gen===engineGen)status('Downloading speech model '+Math.round(p*100)+'%');},
    onPartial:t=>{if(gen!==engineGen)return;localTail={words:normWords(t),final:false};pushLocal();},
    onFinal:t=>{if(gen!==engineGen)return;if(t)localFinals.push({words:normWords(t),final:true});localTail=null;pushLocal();},
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
      if(e&&(e.name==='NotAllowedError'||e.name==='SecurityError')){wantRec=false;live(false);status('Microphone blocked: allow it in site settings');return;}
      toast('On-device engine failed, using the browser engine');
    }
  }else if(pref==='local')toast('No on-device model for this language, using the browser engine');
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
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),900)}
function setFont(v){
  fs=Math.max(16,Math.min(72,v));
  document.documentElement.style.setProperty('--fs',fs+'px');
  try{localStorage.setItem('sf_fs',fs)}catch(e){}
  toast(fs+' px');
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
$('#text').addEventListener('touchstart',()=>{touching=true;lastUser=Date.now()},{passive:true});
const untouch=()=>{touching=false;lastUser=Date.now()};
$('#text').addEventListener('touchend',untouch,{passive:true});
$('#text').addEventListener('touchcancel',untouch,{passive:true});
const pauseFollow=()=>{lastUser=Date.now();if(!follow)return;follow=false;backDir();$('#back').classList.add('show')};
$('#text').addEventListener('scroll',()=>{if(!follow)lastUser=Date.now();backDir();},{passive:true});
$('#text').addEventListener('scroll',pinByScroll,{passive:true});
$('#text').addEventListener('touchmove',pauseFollow,{passive:true});
$('#text').addEventListener('wheel',pauseFollow,{passive:true});
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
  $('#ppar').textContent=par;$('#pcur').textContent=chapters[c].title;
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
  rebuildTracker();markHeard();
}
$('#hbtn').onclick=()=>{
  hdSpoken=!hdSpoken;try{localStorage.setItem('sf_hd',hdSpoken?'1':'0')}catch(e){}
  applyHd();toast(hdSpoken?'Sync: headings included':'Sync: headings skipped');
};
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
  else if(k==='escape'){if($('#outline').classList.contains('show'))closeOutline();else closeSearch();}
  else if(sOpen&&(k==='f3'||((e.ctrlKey||e.metaKey)&&k==='g'))){e.preventDefault();gotoHit(e.shiftKey?hi-1:hi+1);}
});

/* ===== 7. service worker ===== */
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
