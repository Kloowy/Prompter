/* track.js: "where in the script is the speaker right now?"
   A probabilistic tracker (a hidden-Markov forward filter) over the positions of the script.
   Pure functions/classes, no DOM (also loaded by tests/).

   State j  = "the speaker's most recent word is script word j-1" (state 0 = "before the first word").
   Every recognized word moves the belief:
     transition: stay (repeat / junk word), +1 (normal), +2..+K (words skipped), or a JUMP anywhere
                 (jumps land preferably on sentence / paragraph starts, and on what is visible on screen)
     emission:   how well the heard word resembles the script word (exact, same stem, a typo...),
                 with a floor, so a misheard word weakens the belief a little instead of killing it.
   Compared to matching "the last 6 words" from scratch every time this:
     - uses ALL evidence (committed utterances stay in the belief, only the tentative tail is recomputed),
     - needs no hand-tuned bonuses/penalties: skipping, repeating, mishearing, duplicate phrases and far jumps
       all come out of the same few probabilities,
     - gives a confidence, so the cursor moves only when the tracker is sure. */
const TRK={
  T:[.05,.74,.10,.045,.03,.012,.01,.008,.005],   // P(advance by d words), d = 0..K
  FLOOR:.02,                                    // emission floor: P(heard word | any script word)
  JUMP:.03,                                     // P(jump anywhere) per word
  CACHE:256,
  // when the app moves the cursor (confidence = belief mass within +-2 words of the best guess)
  ACC_NEAR:.3,   // small forward step (<= 12 words)
  ACC_FAR:.5,    // big forward jump
  ACC_BACK:.65,  // anything backward
  STRONG:.85     // a jump backed by this much confidence needs no second confirmation
};
class Tracker{
  /* ws: normalized script words; kinds: Uint8Array, 1 = sentence start, 2 = paragraph start */
  constructor(ws,kinds){
    this.ws=ws;this.N=ws.length;const N=this.N;
    const ids=new Map();this.tid=new Int32Array(N+1);this.tid[0]=-1;this.types=[];
    for(let j=0;j<N;j++){let t=ids.get(ws[j]);if(t===undefined){t=this.types.length;ids.set(ws[j],t);this.types.push(ws[j]);}this.tid[j+1]=t;}
    // base jump prior over states: sentence/paragraph starts are the likely places to start reading again
    const J=new Float32Array(N+1);let s=0;
    for(let j=1;j<=N;j++){const k=kinds?kinds[j-1]:0;J[j]=1+(k===1?5:0)+(k===2?12:0);s+=J[j];}
    for(let j=1;j<=N;j++)J[j]/=s;J[0]=0;this.J=J;
    this.jump=TRK.JUMP;this.cache=new Map();this.vlo=-1;this.vhi=-1;this.vb=0;
    this.a=new Float32Array(N+1);this.b=new Float32Array(N+1);
    this.reset(-1);
  }
  /* put (almost) all belief on "last matched word = pos" (pos = -1: nothing read yet) */
  reset(pos){
    const bc=new Float32Array(this.N+1);bc[Math.max(0,pos+1)]=1;this.bc=bc;
  }
  /* the user scrolled by hand: jumps are likely to land on the visible words [lo,hi] (script indices) */
  setView(lo,hi,weight=.6){if(hi>=lo&&lo>=0){this.vlo=lo+1;this.vhi=hi+1;this.vb=weight;}else{this.vlo=this.vhi=-1;this.vb=0;}}
  emitVec(w){
    let v=this.cache.get(w);
    if(v)return v;
    const V=this.types.length;v=new Float32Array(V);const F=TRK.FLOOR;
    for(let t=0;t<V;t++){const m=csim(w,this.types[t]);v[t]=F+(1-F)*m;}
    if(this.cache.size>=TRK.CACHE)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(w,v);return v;
  }
  /* forward-filter `words` (already normalized) starting from belief `base`; returns a NEW belief */
  run(words,base){
    const N=this.N,K=TRK.T.length-1,T=TRK.T,EPS=this.jump,J=this.J,tid=this.tid;
    let cur=this.a;cur.set(base);let nxt=this.b;
    const vl=this.vlo,vh=this.vhi,vb=this.vb,vw=vb>0?vb/(vh-vl+1):0;
    for(const w of words){
      if(!w)continue;
      const ev=this.emitVec(w);let tot=0;
      for(let j=0;j<=N;j++){
        let s=T[0]*cur[j];
        for(let d=1;d<=K&&d<=j;d++)s+=T[d]*cur[j-d];
        let jm=J[j]*(1-vb);if(vb>0&&j>=vl&&j<=vh)jm+=vw;
        const e=j===0?TRK.FLOOR:ev[tid[j]];
        s=(s*(1-EPS)+EPS*jm)*e;
        nxt[j]=s;tot+=s;
      }
      if(tot<=0)break;
      const inv=1/tot;for(let j=0;j<=N;j++)nxt[j]*=inv;
      const t=cur;cur=nxt;nxt=t;
    }
    const out=new Float32Array(N+1);out.set(cur);return out;
  }
  /* best estimate: {pos: script index of the last word read (-1 = none), conf: belief mass within +-2 words of it} */
  estimate(bel){
    let bj=0,bm=-1;
    for(let j=0;j<bel.length;j++)if(bel[j]>bm){bm=bel[j];bj=j;}
    let c=0;for(let j=Math.max(0,bj-2);j<=Math.min(bel.length-1,bj+2);j++)c+=bel[j];
    return{pos:bj-1,conf:c};
  }
  /* One recognizer update. words: heard words (normalized) of the CURRENT utterance, replacing the previous
     tentative hypothesis; final: this utterance is finished, commit it into the belief. */
  step(words,final){
    const bel=this.run(words,this.bc);
    if(final)this.bc=bel;
    const e=this.estimate(bel);e.final=!!final;return e;
  }
  /* an utterance that will never be revised (e.g. a finished recognizer segment) */
  commit(words){if(words.length)this.bc=this.run(words,this.bc);}
}

/* Turns whatever the speech engine delivers into (committed utterances, one tentative tail).
   Works for: Chrome desktop (finals + one interim segment), Chrome Android quirks (growing duplicate segments
   that never become final), result lists that restart without notice, and Vosk (partial hypothesis + final result). */
const fuzzyEq=(a,b)=>a===b||(a&&b&&csim(a,b)>=.85);
class SegFeed{
  constructor(){this.reset();}
  reset(){this.done=0;this.tcIdx=-1;this.tc=0;this.fp=null;this.cw=0;this.prevTotal=0;}
  /* does the start of `a` look like the start of `b`? (used to notice that the engine restarted its result list) */
  sameStart(a,b){
    if(!a||!b||!a.length||!b.length)return true;
    const m=Math.min(3,a.length,b.length);let ok=0;
    for(let i=0;i<m;i++)if(fuzzyEq(a[i],b[i]))ok++;
    return ok>=Math.ceil(m*.6);
  }
  /* segs: [{words:[normalized...], final:bool}] for the session so far (finished utterances + maybe one tentative).
     returns {commit:[wordLists to commit now], tail:[words], nw: how many NEW words arrived with this update}.
     - A tentative utterance that keeps growing (no pauses detected) is committed in pieces: everything but its
       last KEEP words is considered stable once it is longer than MAXTAIL, so the work per update stays small.
     - An unfinished earlier segment that is just an older, shorter copy of a later one (its last 2 words may have
       been revised) is dropped instead of being counted twice: counting words twice made the cursor run ahead.
     - If the engine restarts its result list by itself (shorter list, or the segment we committed last is gone)
       we start over instead of ignoring everything until the list grows past the old length (that looked like a hang). */
  update(segs){
    const MAXTAIL=14,KEEP=8,n=segs.length;
    if(this.done>n||(this.done>0&&!this.sameStart(segs[this.done-1].words,this.fp)))this.reset();
    const commit=[];
    const older=(a,b)=>{                    // is a an older, shorter copy of b?
      if(!a.length)return true;
      if(b.length<a.length-1)return false;
      const stable=Math.max(0,a.length-2);
      if(!stable)return true;
      let bad=0;for(let i=0;i<stable;i++)if(!fuzzyEq(a[i],b[i]))bad++;
      return bad<=Math.floor(stable*.2);
    };
    for(let i=this.done;i<n-1;i++){                 // segments that already have a newer one
      const s=segs[i],w=s.words,skip=i===this.tcIdx?Math.min(this.tc,w.length):0;
      if(s.final||!older(w,segs[i+1].words))commit.push(skip?w.slice(skip):w);
      else if(i===this.tcIdx)this.tcIdx=i+1;       // superseded by its growing copy: the committed prefix carries over
      this.fp=w.slice(0,3);this.done=i+1;
    }
    let tail=[];
    if(n){
      const i=n-1,last=segs[i],w=last.words;
      if(this.tcIdx!==i){this.tcIdx=i;this.tc=0;}
      if(this.tc>w.length)this.tc=w.length;
      if(last.final){
        if(this.done<n){commit.push(w.slice(this.tc));this.done=n;this.fp=w.slice(0,3);}
        this.tc=0;
      }else{
        if(w.length-this.tc>MAXTAIL){const upto=w.length-KEEP;commit.push(w.slice(this.tc,upto));this.tc=upto;}
        tail=w.slice(this.tc);
        this.fp=this.fp||w.slice(0,3);
      }
    }
    for(const c of commit)this.cw+=c.length;
    const total=this.cw+tail.length,nw=Math.max(0,total-this.prevTotal);this.prevTotal=total;
    return{commit,tail,nw};
  }
}

/* The pilot decides what the cursor does with the tracker's estimate (pure logic, tested by tests/sim2.js).
   - continuation: moving forward by about as many words as were heard since the cursor last moved is just reading
     (also when the engine delivers words in bursts); it needs very little confidence
   - correction: our own overshoot is pulled back (needs two agreeing updates)
   - jump: anything else; needs confidence, sensitivity setting, and (unless the evidence is strong) two updates that
     agree, where "agree" allows for the reader moving on in between
   - lead: the engines trail your voice by roughly a second; the cursor is placed `lead` words ahead of the recognized
     position (speaking rate x engine latency x user factor, capped, and not while you pause) */
const PILOT={LATENCY:{browser:1.0,local:.35},MAXLEAD:{browser:3,local:1}};
class Pilot{
  constructor(){this.rate=0;this.mv=[];this.lastMoveAt=-1e9;this.reset();}
  reset(){this.heard=0;this.cand=-1;this.candAt=0;}
  addHeard(n){this.heard=Math.min(80,this.heard+n);}
  lead(o,now){
    if(!o.leadFactor||this.rate<=0||now-this.lastMoveAt>2.2)return 0;
    return Math.max(0,Math.min(o.maxLead,Math.round(this.rate*o.latency*o.leadFactor)));
  }
  /* o: {n: script length, agg, jumpsOn, leadFactor (0..1), latency (s), maxLead}; times in seconds. returns target index or -1 */
  decide(e,cur,o,now){
    if(e.pos<0)return -1;
    const tgt=Math.min(o.n-1,e.pos+this.lead(o,now)),d=tgt-cur;
    if(d===0)return -1;
    if(d<0&&d>=-4)return -1;                                   // jitter, or the lead shrinking
    const fwdMax=Math.max(12,this.heard*2.5+6);
    let need,confirm=null;
    if(d>0&&d<=fwdMax)need=.12+.02*Math.min(d,12);               // continuation of reading
    else if(d<0&&d>=-25){need=.5;confirm='back';}                // correcting our own overshoot
    else{                                                        // a jump
      if(!o.jumpsOn){this.cand=-1;return -1;}
      const farNeed=.75-.4*o.agg/100;
      need=d<0?Math.max(TRK.ACC_BACK,farNeed+.1):farNeed;
      if(o.agg<85&&e.conf<TRK.STRONG)confirm=d<0?'back':'fwd';
    }
    if(e.conf<need)return -1;
    if(confirm){
      const dt=now-this.candAt;
      const ok=this.cand>=0&&dt<2.2&&(confirm==='back'?Math.abs(tgt-this.cand)<=3:(tgt>=this.cand-3&&tgt<=this.cand+4+Math.ceil(dt*6)));
      if(!ok){this.cand=tgt;this.candAt=now;return -1;}
    }
    this.cand=-1;
    return tgt;
  }
  /* call after the cursor really moved from `from` to `to` */
  moved(from,to,now){
    this.heard=0;this.lastMoveAt=now;
    if(to>from&&to-from<=12){
      this.mv.push([now,to]);while(this.mv.length&&now-this.mv[0][0]>12)this.mv.shift();
      if(this.mv.length>=4){
        const a=this.mv[0],b=this.mv[this.mv.length-1],dt=b[0]-a[0];
        if(dt>=2.5){const r=Math.max(0,Math.min(6,(b[1]-a[1])/dt));this.rate=this.rate?this.rate*.85+r*.15:r;}
      }
    }else if(Math.abs(to-from)>12)this.mv=[];
  }
}
