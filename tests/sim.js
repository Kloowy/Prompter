// node tests/sim.js : simulates a speaker + a noisy recognizer and compares the OLD matcher (match.js locate)
// with the NEW probabilistic tracker (track.js). Prints accuracy and recovery-after-jump numbers.
const fs=require('fs'),path=require('path');
const src=['match','track'].map(f=>fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8')).join('\n');
const L=new Function(src+'\nreturn {norm,csim,locate,quick,Tracker,SegFeed,TRK}')();
const OPT=JSON.parse(process.argv[2]||'{}');
Object.assign(L.TRK,OPT.trk||{});
function rng(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)}
const SYL=['ka','to','mi','ra','ne','lu','so','vi','da','pe','go','fu','ba','ze','hi','jo','tra','sti','mon','der','con','pre','ing','tion'];
function makeScript(r,nSent){
  const vocab=[];for(let i=0;i<500;i++){let w='';const n=1+Math.floor(r()*3);for(let k=0;k<n;k++)w+=SYL[Math.floor(r()*SYL.length)];vocab.push(w);}
  const fn=['the','of','and','to','in','is','that','we','it','for','this','are','with','as','on','be'];
  const zipf=()=>{const u=r();return vocab[Math.min(vocab.length-1,Math.floor(Math.pow(u,2.2)*vocab.length))]};
  const words=[],starts=[];let para=0;
  for(let s=0;s<nSent;s++){
    const n=8+Math.floor(r()*9);
    for(let i=0;i<n;i++){const w=r()<.33?fn[Math.floor(r()*fn.length)]:zipf();starts.push(i===0?(s%4===0?2:1):0);words.push(w);}
  }
  return{words,starts,vocab};
}
function fuzzy(w,r,vocab){
  const k=r();
  if(k<.35&&w.length>3)return w.slice(0,-1);            // lost ending
  if(k<.6&&w.length>3)return w+'s';                     // extra ending
  if(k<.75&&w.length>4)return w.slice(0,2)+w[3]+w[2]+w.slice(4); // swap
  return vocab[Math.floor(r()*vocab.length)];           // totally different word
}
function runScenario(seed,mode,P){
  const r=rng(seed),{words,starts,vocab}=makeScript(r,45);
  const ws=words.map(L.norm),N=ws.length;
  // speaker path
  const spoken=[];let i=0;const jumps=[];
  while(spoken.length<260&&i<N){
    const u=r();
    if(u<P.jump&&spoken.length>10){const cand=[];for(let k=0;k<N;k++)if(starts[k])cand.push(k);i=cand[Math.floor(r()*cand.length)];jumps.push(spoken.length);}
    else if(u<P.jump+P.skip){i=Math.min(N-1,i+1+Math.floor(r()*6));}
    else if(u<P.jump+P.skip+.01&&spoken.length)i=Math.max(0,i-1);
    spoken.push(i);i++;
  }
  // recognizer: heard word list with times
  const dt=.38,delay=P.delay;const heard=[];   // {t, w, idx(true text index or -1)}
  spoken.forEach((idx,n)=>{
    const t=n*dt+delay;const u=r();
    if(u<P.del)return;
    let w=ws[idx];if(u<P.del+P.sub)w=fuzzy(w,r,vocab);
    heard.push({t,w:L.norm(w),idx,n});
    if(r()<P.ins)heard.push({t:t+.05,w:vocab[Math.floor(r()*vocab.length)],idx:-1,n});
  });
  // utterances: boundaries every 6..14 spoken words
  const bounds=[];{let n=0;while(n<spoken.length){n+=6+Math.floor(r()*9);bounds.push(n);}}
  const utt=n=>bounds.findIndex(b=>n<b);
  // matchable arrays (all words matchable here)
  const mw=ws;
  const kinds=Uint8Array.from(starts);
  const tracker=new L.Tracker(mw,kinds);const feed=new L.SegFeed();
  let posO=0,posN=-1;const T=spoken.length*dt+delay+2;
  const rows=[];
  for(let t=.2;t<T;t+=.2){
    const visible=heard.filter(h=>h.t<=t);
    if(!visible.length)continue;
    const lastN=visible[visible.length-1].n;
    // segments: group by utterance
    const segs=[];let curU=-1;
    for(const h of visible){const u=utt(h.n);if(u!==curU){segs.push({words:[],final:false,u});curU=u;}segs[segs.length-1].words.push(h.w);}
    // an utterance is final once its last spoken word is >= .5s old
    segs.forEach(s=>{const lastWord=bounds[s.u]-1;const tLast=lastWord*dt+delay+.5;s.final=t>=tLast&&s.u<utt(spoken.length-1)+1&&t>=tLast;});
    const truthN=lastN;const truth=spoken[truthN];
    if(mode==='old'){
      const sp=[];for(const s of segs.slice(-3))for(const w of s.words)sp.push(w);
      const q=sp.slice(-6);const fin=segs[segs.length-1].final;
      const qk=L.quick(q[q.length-1],mw,posO);if(qk>=0)posO=qk;
      const rr=L.locate(q,mw,posO,fin);if(rr>=0&&rr!==posO)posO=rr;
      rows.push({t,err:posO-truth,truthN});
    }else{
      const {commit,tail}=feed.update(segs);
      commit.forEach(c=>tracker.commit(c));
      const e=tracker.step(tail,false);
      if(e.pos>=0){
        const d=e.pos-posN;
        if(d>0&&((d<=12&&e.conf>=P.cf)||(d>12&&e.conf>=P.cj))||(d<-4&&e.conf>=P.cb))posN=e.pos;   // same policy as the app
      }
      rows.push({t,err:posN-truth,truthN});
    }
  }
  // metrics
  let ok=0,sum=0;rows.forEach(x=>{if(Math.abs(x.err)<=2)ok++;sum+=Math.min(30,Math.abs(x.err));});
  // recovery after jumps: first time after jump with |err|<=3 for 3 consecutive rows
  const rec=[];
  for(const jn of jumps){
    const tj=jn*dt+delay;let k=rows.findIndex(x=>x.t>=tj);if(k<0)continue;
    let got=-1;for(let q=k;q<rows.length-2;q++){if([0,1,2].every(z=>Math.abs(rows[q+z].err)<=3)){got=rows[q].t-tj;break;}if(rows[q].t-tj>8)break;}
    rec.push(got<0?9:got);
  }
  return{n:rows.length,ok,sum,rec};
}
const P=Object.assign({jump:.006,skip:.03,del:.06,sub:.12,ins:.04,delay:.8,cf:L.TRK.ACC_NEAR,cj:L.TRK.ACC_FAR,cb:L.TRK.ACC_BACK},OPT.p||{});
for(const mode of ['old','new']){
  let n=0,ok=0,sum=0,rec=[];const t0=Date.now();
  for(let s=1;s<=40;s++){const x=runScenario(s*7919,mode,P);n+=x.n;ok+=x.ok;sum+=x.sum;rec.push(...x.rec);}
  rec.sort((a,b)=>a-b);const med=rec.length?rec[Math.floor(rec.length/2)]:0;const fail=rec.filter(x=>x>=9).length;
  console.log(mode.padEnd(4),'within±2:',(100*ok/n).toFixed(1)+'%','meanErr:',(sum/n).toFixed(2),'jumps:',rec.length,'recovery median:',med.toFixed(2)+'s','failed:',fail,' time',Date.now()-t0,'ms');
}
