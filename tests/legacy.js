/* tests/legacy.js: the v15 cursor logic frozen as a baseline, so tests/sim2.js can compare it with the current one. Not used by the app. */
class LegacySegFeed{
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

/* v15 policy (was applyEstimate in app.js) */
function legacyDecide(e,cur,st,o,now){
  if(e.pos<0)return -1;
  const d=e.pos-cur;if(!d)return -1;
  if(d<0&&d>=-4)return -1;
  const far=d>12||d<0;
  if(far&&!o.jumpsOn){st.cand=-1;return -1;}
  const aggFar=.75-.4*o.agg/100;
  const need=d<0?Math.max(TRK.ACC_BACK,aggFar+.1):(d<=12?TRK.ACC_NEAR:aggFar);
  if(e.conf<need)return -1;
  if(far&&o.agg<85&&e.conf<TRK.STRONG){
    if(!(st.cand>=0&&now-st.at<1.5&&Math.abs(st.cand-e.pos)<=3)){st.cand=e.pos;st.at=now;return -1;}
  }
  st.cand=-1;return e.pos;
}
