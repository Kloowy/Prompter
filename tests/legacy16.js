/* tests/legacy16.js: the v16/v17 cursor logic frozen as a baseline for tests/sim3.js. Not used by the app. */
const fuzzyEq16=(a,b)=>a===b||(a&&b&&csim(a,b)>=.85);
class SegFeed16{
  constructor(){this.reset();}
  reset(){this.done=0;this.tcIdx=-1;this.tc=0;this.fp=null;this.cw=0;this.prevTotal=0;}
  /* does the start of `a` look like the start of `b`? (used to notice that the engine restarted its result list) */
  sameStart(a,b){
    if(!a||!b||!a.length||!b.length)return true;
    const m=Math.min(3,a.length,b.length);let ok=0;
    for(let i=0;i<m;i++)if(fuzzyEq16(a[i],b[i]))ok++;
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
      let bad=0;for(let i=0;i<stable;i++)if(!fuzzyEq16(a[i],b[i]))bad++;
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
const PILOT16={LATENCY:{browser:1.0,local:.35},MAXLEAD:{browser:3,local:1}};
class Pilot16{
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
