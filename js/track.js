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
  ACC_BACK:.65   // anything backward
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
    this.cache=new Map();this.vlo=-1;this.vhi=-1;this.vb=0;
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
    const N=this.N,K=TRK.T.length-1,T=TRK.T,EPS=TRK.JUMP,J=this.J,tid=this.tid;
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
   that never become final), and Vosk (partial hypothesis + final result). */
class SegFeed{
  constructor(){this.reset();}
  reset(){this.done=0;this.tcIdx=-1;this.tc=0;}
  /* segs: [{words:[normalized...], final:bool}] for the session so far (finished utterances + maybe one tentative).
     returns {commit:[wordLists to commit now], tail:[words]}.
     A tentative utterance that keeps growing (no pauses detected) is committed in pieces: everything but its
     last KEEP words is considered stable once it is longer than MAXTAIL, so the work per update stays small. */
  update(segs){
    const MAXTAIL=14,KEEP=8;
    const commit=[],n=segs.length;
    const pre=(a,b)=>{ // is a (nearly) a prefix of b: b is a growing version of a
      const m=Math.min(a.length,b.length);if(!m)return false;
      let ok=0;for(let i=0;i<m;i++)if(a[i]===b[i]||(a[i]&&b[i]&&csim(a[i],b[i])>=.85))ok++;
      return ok/m>=.8&&b.length>=a.length;
    };
    for(let i=this.done;i<n-1;i++){                 // finished segments (a newer one exists)
      const w=segs[i].words,skip=i===this.tcIdx?Math.min(this.tc,w.length):0;
      if(!pre(w,segs[i+1].words))commit.push(skip?w.slice(skip):w);
      else if(i===this.tcIdx)this.tcIdx=i+1;       // superseded by its growing copy: the committed prefix carries over
      this.done=i+1;
    }
    let tail=[];
    if(n){
      const i=n-1,last=segs[i],w=last.words;
      if(this.tcIdx!==i){this.tcIdx=i;this.tc=0;}
      if(this.tc>w.length)this.tc=w.length;
      if(last.final){
        if(this.done<n){commit.push(w.slice(this.tc));this.done=n;}
        this.tc=0;
      }else{
        if(w.length-this.tc>MAXTAIL){const upto=w.length-KEEP;commit.push(w.slice(this.tc,upto));this.tc=upto;}
        tail=w.slice(this.tc);
      }
    }
    return{commit,tail};
  }
}
