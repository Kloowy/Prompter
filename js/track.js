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
    for(let t=0;t<V;t++){const m=sim(w,this.types[t]);v[t]=F+(1-F)*m;}   // direct (the word cache of csim would fill up with half-heard fragments)
    if(this.cache.size>=TRK.CACHE)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(w,v);return v;
  }
  /* forward-filter `words` (already normalized) starting from belief `base`; returns a NEW belief */
  run(words,base){
    this.lastTot=[];
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
      this.lastTot.push(tot);   // P(this word | where we were): high when it matches what is expected, tiny for noise or a stray word from elsewhere
      const inv=1/tot;for(let j=0;j<=N;j++)nxt[j]*=inv;
      const t=cur;cur=nxt;nxt=t;
    }
    const out=new Float32Array(N+1);out.set(cur);return out;
  }
  /* best estimate: {pos: script index of the last word read (-1 = none), conf: belief mass within +-2 words of it,
     local: belief mass in the neighbourhood of ref (ref-1 .. ref+win): "the words can be explained right here",
     locPos/locConf: the best place INSIDE that neighbourhood and how sure we are of it relative to the neighbourhood,
     fit: share of the last words that matched what was expected (noise and stray words do not)} */
  estimate(bel,ref,win){
    let bj=0,bm=-1;
    for(let j=0;j<bel.length;j++)if(bel[j]>bm){bm=bel[j];bj=j;}
    let c=0;for(let j=Math.max(0,bj-2);j<=Math.min(bel.length-1,bj+2);j++)c+=bel[j];
    const r={pos:bj-1,conf:c,local:0,locPos:-1,locConf:0,fit:1};
    const tot=this.lastTot||[];
    if(tot.length){let ok=0;for(const x of tot)if(x>=.2)ok++;r.fit=ok/tot.length;}
    if(ref!==undefined&&ref>=-1){
      const lo=Math.max(0,ref-1),hi=Math.min(bel.length-1,ref+(win||10)+1);
      let lm=0,lj=-1,lb=-1;
      for(let j=lo;j<=hi;j++){lm+=bel[j];if(bel[j]>lb){lb=bel[j];lj=j;}}
      r.local=lm;
      if(lj>=0&&lm>0){let lc=0;for(let j=Math.max(lo,lj-2);j<=Math.min(hi,lj+2);j++)lc+=bel[j];r.locPos=lj-1;r.locConf=lc/lm;}
    }
    return r;
  }
  /* One recognizer update. words: heard words (normalized) of the CURRENT utterance, replacing the previous
     tentative hypothesis; final: this utterance is finished, commit it into the belief. */
  step(words,final,ref,win){
    const bel=this.run(words,this.bc);
    if(final)this.bc=bel;
    const e=this.estimate(bel,ref,win);e.final=!!final;return e;
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
    let skipped=0;
    if(this.done>n||(this.done>0&&!this.sameStart(segs[this.done-1].words,this.fp))){
      // the engine restarted or rewrote its list. Never re-count segments that may already be in the belief (that made the
      // cursor leap ahead): continue from the newest segment; the words of the skipped ones only count as "heard".
      this.reset();this.done=Math.max(0,n-1);
      for(let i=0;i<this.done;i++)skipped+=segs[i].words.length;
      this.fp=this.done?segs[this.done-1].words.slice(0,3):null;
    }
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
    this.cw+=skipped;
    const total=this.cw+tail.length,nw=Math.max(0,total-this.prevTotal);this.prevTotal=total;
    return{commit,tail,nw};
  }
}

/* The pilot decides what the cursor does with the tracker's estimate (pure logic, tested by tests/run.js, sim2.js, sim3.js).

   One idea carries it: CONTINUITY. `est` is where the tracker last placed you. Words that fit what is expected around `est`
   (the belief says "we are still around here") just move you on: the cursor follows even if it is far behind, and however low
   the jump sensitivity is (catching up needs no permission). Noise does not move you: the recent words must actually fit.
   Only when the neighbourhood can NOT explain the words (little belief mass there) is a jump considered, and then
     - jumping must be switched on,
     - the new place must be sure enough (sensitivity slider) and the words must fit there,
     - unless the evidence is overwhelming, further words must confirm it (more of them when the sensitivity is low).
   So a word that is simply the next one in your sentence can never move you away, and silence or garbage can never carry
   the cursor across the text. A step forward is never larger than 60 words unless it is a confirmed jump.
   Lead: the engines trail your voice by roughly a second; the cursor is placed `lead` words ahead of the recognized
   position (speaking rate x engine latency x user factor, capped, and not while you pause). */
const PILOT={LATENCY:{browser:1.0,local:.35},MAXLEAD:{browser:3,local:1},MAXCONT:60,FIT:.2,LOCMIN:.2,CONF0:.1,CONF1:.01,MINNEW:[5,3,2]};   // thresholds tuned on tests/sim2.js: FIT = share of recent words that must match; LOCMIN = belief mass that must sit around the cursor to count as "reading on"; CONF0/1 = confidence needed for a step   // MINNEW: further words that must confirm a jump when sensitivity is low / middle / high
class Pilot{
  constructor(){this.rate=0;this.mv=[];this.lastMoveAt=-1e9;this.anchor(-1,0);}
  /* the cursor was put somewhere by hand (or a new text started): that is where we are now */
  anchor(pos,now){this.est=pos;this.estAt=now||0;this.heard=0;this.cand=-1;this.candAt=0;this.candHeard=0;this.lastEstPos=undefined;this.lostPos=-1;this.lostAt=-1e9;}
  reset(){this.heard=0;this.cand=-1;}
  addHeard(n){this.heard=Math.min(200,this.heard+n);}
  /* how far ahead of `est` a continuation may reach: what the heard words can explain (a little more than their number), or what the
     time since the last move allows (about two words a second) */
  contMax(now){return Math.min(PILOT.MAXCONT,Math.max(3,Math.ceil(this.heard*1.5)+2,Math.round(2*Math.max(0,now-this.estAt))+2));}
  /* The cursor sits `o.leadWords` words ahead of the recognized word (0..3). A FIXED number on purpose: a lead that is switched on and
     off by timers (pauses, speaking rate) made the cursor run ahead and then step back, or wait and then leap. */
  lead(o){return Math.max(0,Math.min(3,o.leadWords|0));}
  accept(pos,now){
    this.est=pos;this.estAt=now;this.heard=0;this.cand=-1;
    if(this.lastEstPos!==undefined&&pos>this.lastEstPos&&pos-this.lastEstPos<=12){
      this.mv.push([now,pos]);while(this.mv.length&&now-this.mv[0][0]>12)this.mv.shift();
      if(this.mv.length>=4){
        const a=this.mv[0],b=this.mv[this.mv.length-1],dt=b[0]-a[0];
        if(dt>=2.5){const r=Math.max(0,Math.min(6,(b[1]-a[1])/dt));this.rate=this.rate?this.rate*.85+r*.15:r;}
      }
    }else if(this.lastEstPos!==undefined&&Math.abs(pos-this.lastEstPos)>12)this.mv=[];
    this.lastEstPos=pos;
  }
  /* e: tracker.step(...) result (call it with ref=pilot.est and win=pilot.contMax(now)); cur: where the cursor is;
     o: {n, agg, jumpsOn, leadFactor, latency, maxLead}; now in seconds. returns the script index to move the cursor to, or -1 */
  decide(e,cur,o,now){
    if(e.pos<0)return -1;
    if(this.est<0){this.est=cur;this.estAt=now;this.lastEstPos=cur;}
    const lead=this.lead(o);
    // 1) the words are explained around where we were: reading on
    if(e.local>=PILOT.LOCMIN&&e.locPos>=0){
      this.cand=-1;
      const d=e.locPos-this.est;
      if(d<=0)return -1;                                                   // nothing new (or jitter): stay
      if(e.fit<PILOT.FIT)return -1;                                        // noise: the words do not match what is expected
      if(e.locConf<PILOT.CONF0+PILOT.CONF1*Math.min(d,12))return -1;                        // not sure yet; the words keep adding up
      this.accept(e.locPos,now);
      const tgt=Math.min(o.n-1,e.locPos+lead);
      return tgt>cur?tgt:-1;                                               // the cursor never steps back while you read on
    }
    // 2) the neighbourhood cannot explain them: a claim that you jumped
    if(!o.jumpsOn){   // not allowed to leap: remember where the words fit, so the app can OFFER the jump instead
      this.cand=-1;if(e.fit>=.5&&e.conf>=.6&&e.local<.2){this.lostPos=e.pos;this.lostAt=now;}
      return -1;
    }
    if(e.fit<PILOT.FIT){this.cand=-1;return -1;}
    const dEst=e.pos-this.est,farNeed=.75-.4*o.agg/100;
    if(dEst<0&&dEst>=-8){this.cand=-1;return -1;}                           // a few words back: the engine revised its guess, not you
    if(this.heard<3)return -1;                                              // a jump needs at least a few words as evidence
    if(e.conf<(dEst<0?Math.max(TRK.ACC_BACK,farNeed+.1):farNeed))return -1;
    if(o.agg<85&&e.conf<TRK.STRONG){
      const minNew=PILOT.MINNEW[o.agg<30?0:o.agg<70?1:2],dt=now-this.candAt;
      const ok=this.cand>=0&&dt<2.5&&this.heard-this.candHeard>=minNew&&e.pos>=this.cand-3&&e.pos<=this.cand+4+Math.ceil(dt*6);
      if(!ok){this.cand=e.pos;this.candAt=now;this.candHeard=this.heard;return -1;}
    }
    this.accept(e.pos,now);this.mv=[];
    return Math.min(o.n-1,e.pos+lead);
  }
  /* call after the cursor really moved */
  moved(from,to,now){this.lastMoveAt=now;}
}
