/* match.js: speech -> position in text. Pure functions, no DOM (also loaded by tests/run.js). */
const norm=w=>w.toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
function lev(a,b){const m=a.length,n=b.length;let p=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]}
function sim(a,b){
  if(!a||!b)return 0;if(a===b)return 1;
  const m=Math.min(a.length,b.length),M=Math.max(a.length,b.length);
  if(m<4)return 0;
  let k=0;while(k<m&&a[k]===b[k])k++;
  if(k>=4&&k/M>=.6)return .85;
  if(M-m>2)return 0;
  const r=1-lev(a,b)/M;
  return r>=.72?r*.9:0;
}
/* sim() results are cached per (spoken word, text word): the spoken window slides one word at a time,
   so on every recognition event almost all lookups are cache hits and a full-text scan stays cheap. */
let simCache=new Map();
function csim(w,t){
  let m=simCache.get(w);
  if(!m){if(simCache.size>400)simCache=new Map();m=new Map();simCache.set(w,m);}
  let v=m.get(t);if(v===undefined){v=sim(w,t);m.set(t,v);}
  return v;
}
/* Looks at the last few spoken words (sp) and finds the best place in the text (ws = array of normalized words).
   Skips of words (in text or in speech) are tolerated; forward candidates are preferred over backward ones,
   so a repeated phrase picks the forward occurrence. Returns the new index or -1. */
function locateIn(sp,ws,pos,final,s0,s1){
  const N=ws.length;let best=-1,bs=0;
  for(let s=s0;s<s1;s++){
    let ptr=s,sc=0,m=0,end=-1,lastK=-1;
    for(let k=0;k<sp.length;k++){
      const w=sp[k],lim=Math.min(N,ptr+(m?5:1));
      for(let j=ptr;j<lim;j++){
        const q=csim(w,ws[j]);
        if(q>0){sc+=q*Math.min(w.length,7)/7-0.08*(j-ptr);m++;end=j;ptr=j+1;lastK=k;break;}
      }
    }
    if(!m)continue;
    // A lone matched word only counts if it is long, distinctive and was just spoken;
    // stops short common words (and stale words from the window) nudging the position.
    if(m===1&&(sp[lastK].length<6||lastK<sp.length-2))continue;
    const d=end-pos;let a=sc;
    if(d>=0&&d<=30)a+=0.6*(1-d/30);
    else if(d>30)a-=Math.min(1,(d-30)*0.01);
    else if(d>=-2){if(!final)continue;}   // tiny step back: only on final results (interim results jitter)
    else{if(m<3)continue;a-=2;}
    if(a>bs){bs=a;best=end;}
  }
  return bs>=1.1?best:-1;
}
/* Local search first (a few dozen words around the cursor, ~10x cheaper on long texts);
   only if that finds nothing convincing, the whole text is searched (big skips, jumps back). */
function locate(sp,ws,pos,final){
  const N=ws.length;
  if(N>300){const r=locateIn(sp,ws,pos,final,Math.max(0,pos-40),Math.min(N,pos+80));if(r>=0)return r;}
  return locateIn(sp,ws,pos,final,0,N);
}
/* Fast path: the newest spoken word is the next word of the text (or 2-3 ahead if one was swallowed).
   Lets the cursor move the moment a word is recognized instead of waiting for a multi-word match.
   Short words only count for the very next word; a partial interim word counts if it is a prefix. */
function quick(w,ws,pos){
  if(!w)return -1;
  for(let j=pos+1;j<=Math.min(ws.length-1,pos+3);j++){
    const t=ws[j];
    if(w===t&&(j===pos+1||w.length>=4))return j;
    if(w.length>=4&&(csim(w,t)>0||(j===pos+1&&t.length>w.length&&t.startsWith(w))))return j;
  }
  return -1;
}
/* Guesses the speech language from the text: script first, then letters and common short words. */
const LANGS={
  'de-DE':['äöüß','der die das und ist nicht ich sie es mit den zu ein eine auf für von dem wir auch sich'],
  'fr-FR':['éèêàçœûîô','le les et est des une un pour pas que qui dans du ce nous vous au sur avec il'],
  'es-ES':['ñ¿¡áíóú','el los las y es que en un una por para con no se del lo como más pero'],
  'it-IT':['èàòùì','il lo gli e che di un una per non con del della sono è anche come questo'],
  'pt-PT':['ãõçáâêó','o os as e é que um uma para não com do da em se dos das mais como'],
  'pl-PL':['ąćęłńśźżó','i w z na nie to jest się że do jak co ale tak od po'],
  'ro-RO':['ăâîșşțţ','și de la în este un o cu pe care nu sunt mai să din'],
  'tr-TR':['çğışöü','ve bir bu da de için ile ne çok olarak gibi daha ama'],
  'en-US':['','the and is of to in that it for with this are you we on be as have']
};
function detectLang(text){
  const ws=(text.toLowerCase().match(/\p{L}+/gu)||[]).slice(0,3000);
  if(!ws.length)return null;
  let cyr=0,lat=0;
  for(const w of ws){if(/[\u0400-\u04ff]/.test(w))cyr++;else if(/[a-zà-ž]/.test(w))lat++;}
  if(cyr>lat){
    const t=ws.join(' '),uk=(t.match(/[іїєґ]/g)||[]).length,ru=(t.match(/[ыэъё]/g)||[]).length;
    return uk>ru?'uk-UA':'ru-RU';
  }
  if(!lat)return null;
  const t=ws.join(''),sc={};
  for(const k in LANGS){
    const [ch,sw]=LANGS[k],set=new Set(sw.split(' '));let v=0;
    for(const c of ch)v+=(t.split(c).length-1)*1.5;
    for(const w of ws)if(set.has(w))v++;
    sc[k]=v;
  }
  return Object.keys(sc).reduce((a,b)=>sc[b]>sc[a]?b:a);
}
function resetSimCache(){simCache=new Map();}
/* Words the speaker does not say (e.g. headings) are left out of matching, but kept for display.
   Returns the compact word list mw, mmap (compact -> real index) and rmap (real index -> compact index at/after it). */
function matchIndex(wn,skip){
  const mw=[],mmap=[];
  for(let i=0;i<wn.length;i++)if(!skip[i]){mmap.push(i);mw.push(wn[i]);}
  if(!mw.length)wn.forEach((w,i)=>{mmap.push(i);mw.push(w);});   // nothing speakable: match everything
  const rmap=new Array(wn.length);let j=0;
  for(let i=0;i<wn.length;i++){while(j<mmap.length-1&&mmap[j]<i)j++;rmap[i]=j;}
  return {mw,mmap,rmap};
}
