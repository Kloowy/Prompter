// node tests/sim2.js [json options]
// Simulates the BROWSER engine as it really behaves (delay, bursts, duplicate segments, silent list restarts, pauses,
// a reader who speeds up and slows down) and compares the previous cursor logic (tests/legacy.js) with the current one.
// Truth = where the speaker REALLY is, so cursor lag (negative) and overshoot (positive) are both visible.
const fs=require('fs'),path=require('path');
const src=['match','track'].map(f=>fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8')).join('\n')+'\n'+fs.readFileSync(path.join(__dirname,'legacy.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'legacy16.js'),'utf8');
const L=new Function(src+'\nreturn {norm,Tracker,SegFeed,LegacySegFeed,legacyDecide,Pilot,PILOT,TRK,SegFeed16,Pilot16}')();
const OPT=JSON.parse(process.argv[2]||'{}');
Object.assign(L.PILOT,OPT.pilot||{});Object.assign(L.TRK,OPT.trk||{});
function rng(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)}
const SYL=['ka','to','mi','ra','ne','lu','so','vi','da','pe','go','fu','ba','ze','hi','jo','tra','sti','mon','der','con','pre','ing','tion'];
function makeScript(r,nSent,rep=0){
  const vocab=[];for(let i=0;i<500;i++){let w='';const n=1+Math.floor(r()*3);for(let k=0;k<n;k++)w+=SYL[Math.floor(r()*SYL.length)];vocab.push(w);}
  const fn=['the','of','and','to','in','is','that','we','it','for','this','are','with','as','on','be'];
  const zipf=()=>vocab[Math.min(vocab.length-1,Math.floor(Math.pow(r(),2.2)*vocab.length))];
  const words=[],starts=[];
  const sents=[];
  for(let s=0;s<nSent;s++){
    let sw;
    if(rep&&sents.length>3&&r()<rep)sw=sents[Math.floor(r()*sents.length)].slice();       // the same sentence again, elsewhere
    else{const n=8+Math.floor(r()*9);sw=[];for(let i=0;i<n;i++)sw.push(r()<.33?fn[Math.floor(r()*fn.length)]:zipf());}
    sents.push(sw);
    sw.forEach((w,i)=>{words.push(w);starts.push(i===0?(s%4===0?2:1):0);});
  }
  return{words,starts,vocab};
}
function fuzzy(w,r,vocab){const k=r();if(k<.35&&w.length>3)return w.slice(0,-1);if(k<.6&&w.length>3)return w+'s';if(k<.75&&w.length>4)return w.slice(0,2)+w[3]+w[2]+w.slice(4);return vocab[Math.floor(r()*vocab.length)];}

function scenario(seed,P){
  const r=rng(seed),{words,starts,vocab}=makeScript(r,50,P.rep||0);
  const ws=words.map(L.norm),N=ws.length;
  // speaker: path through the script, with real pauses and speed changes
  const spoken=[],tw=[],jumpT=[];let i=0,t=2,speed=1;
  while(spoken.length<300&&i<N){
    const u=r();
    if(u<P.jump&&spoken.length>10){const c=[];for(let k=0;k<N;k++)if(starts[k])c.push(k);i=c[Math.floor(r()*c.length)];jumpT.push(t);}
    else if(u<P.jump+P.skip)i=Math.min(N-1,i+1+Math.floor(r()*6));
    if(spoken.length%25===0)speed=.8+r()*.6;
    t+=.4/speed*(.8+.4*r());
    if(starts[i]&&r()<.35)t+=1+2*r();
    spoken.push(i);tw.push(t);i++;
  }
  // recognizer: words are delivered with a delay
  const heard=[];let lastDv=0;
  spoken.forEach((idx,n)=>{
    const u=r();if(u<P.del)return;
    if(P.stall&&tw[n]+P.delay>P.stall[0]&&tw[n]<P.stall[1])return;     // dead session: nothing is heard
    let w=ws[idx];if(u<P.del+P.sub)w=fuzzy(w,r,vocab);
    const dv=Math.max(lastDv,tw[n]+P.delay*(.7+.6*r()));lastDv=dv;
    heard.push({dv,w:L.norm(w),n});
    if(r()<P.ins)heard.push({dv:dv+.05,w:vocab[Math.floor(r()*vocab.length)],n});
  });
  // hallucinations: during pauses the recognizer keeps guessing words (any word of the script) about once a second
  if(P.halluc){for(let n=0;n<spoken.length-1;n++){const gap=tw[n+1]-tw[n];if(gap>1){for(let x=tw[n]+.8;x<tw[n+1];x+=1/P.halluc)heard.push({dv:Math.max(lastDv,x+P.delay),w:ws[Math.floor(r()*N)],n,hall:true});}}heard.sort((a,b)=>a.dv-b.dv);}
  // garbage windows (a hard stretch of accent / noise): everything heard in them is a random non-script word
  if(P.garb){const wins=[];for(let k=0;k<P.garb;k++){const a0=8+r()*(tw[tw.length-1]-30);wins.push([a0,a0+8]);}
    for(let k=heard.length-1;k>=0;k--){const h=heard[k];if(!h.hall&&wins.some(w=>tw[h.n]>=w[0]&&tw[h.n]<=w[1])){if(r()<.6)heard.splice(k,1);else h.w='g'+Math.floor(r()*999);}}}
  // utterances: end at a pause >= .9 s or after 16 words
  const utt=new Array(spoken.length);let u0=0,cnt=0;
  for(let n=0;n<spoken.length;n++){utt[n]=u0;cnt++;if((tw[n+1]!==undefined&&tw[n+1]-tw[n]>=.9)||cnt>=16){u0++;cnt=0;}}
  const uEnd={};for(let n=0;n<spoken.length;n++)uEnd[utt[n]]=n;
  const finalAt=u=>tw[uEnd[u]]+P.delay+.5;
  // update times
  const ups=[];if(P.shape==='burst'){let x=3;while(x<tw[tw.length-1]+4){ups.push(x);x+=.3+1.5*r();}}else for(let x=3;x<tw[tw.length-1]+4;x+=.25)ups.push(x);
  return{ws,N,starts,spoken,tw,heard,utt,finalAt,ups,jumpT,vocab,r};
}
function listAt(sc,T,P,state){
  const hs=sc.heard.filter(h=>h.dv<=T);
  const byU=new Map();for(const h of hs){const u=sc.utt[h.n];if(!byU.has(u))byU.set(u,[]);byU.get(u).push(h.w);}
  let us=[...byU.keys()].sort((a,b)=>a-b);
  if(P.shape==='reset'){const cut=Math.floor(T/25)*25;us=us.filter(u=>sc.tw[sc.heard.find(h=>sc.utt[h.n]===u).n]>=cut-1+0);}   // list restarts every 25 s, silently
  const segs=[];
  for(const u of us){
    const w=byU.get(u),fin=sc.finalAt(u)<=T;
    if(P.shape==='dup'){
      // every update left another (non-final) copy of the utterance so far; the last 2 words of older copies were revised later
      const copies=state.copies[u]||(state.copies[u]=[]);
      const last=copies.length?copies[copies.length-1]:null;
      if(!last||last.length!==w.length||fin!==last.fin){const cp=w.slice();cp.fin=fin;copies.push(cp);}
      copies.slice(-8).forEach((c,k,arr)=>{const x=c.slice();if(k<arr.length-1&&x.length>2&&((k*7+u)%3===0))x[x.length-1]='zz'+x.length;segs.push({words:x,final:k===arr.length-1&&fin});});
    }else segs.push({words:w,final:fin});
  }
  return segs;
}
function makePipe(kind,sc,P){
  if(kind==='v16'){
    const tr=new L.Tracker(sc.ws,Uint8Array.from(sc.starts));tr.jump=P.jumpsOff?.0004:.005*Math.pow(24,P.agg/100);tr.reset(-1);
    const o={n:sc.N,agg:P.agg,jumpsOn:!P.jumpsOff,leadFactor:P.lead,latency:L.PILOT.LATENCY.browser,maxLead:L.PILOT.MAXLEAD.browser};
    const feed=new L.SegFeed16(),pilot=new L.Pilot16();let pos=-1;
    return{update(segs,now){const {commit,tail,nw}=feed.update(segs);commit.forEach(c=>tr.commit(c));pilot.addHeard(nw);
      const e=tr.step(tail,false);const t=pilot.decide(e,pos,o,now);if(t>=0){pilot.moved(pos,t,now);pos=t;}return pos;}};
  }
  const kinds=Uint8Array.from(sc.starts);
  const tr=new L.Tracker(sc.ws,kinds);const agg=P.agg,eps=kind==='new'?.002*Math.pow(30,agg/100):.005*Math.pow(24,agg/100);tr.jump=P.jumpsOff?.0004:eps;tr.reset(-1);
  const o={n:sc.N,agg,jumpsOn:!P.jumpsOff,leadFactor:P.lead,leadWords:P.leadWords===undefined?1:P.leadWords,latency:L.PILOT.LATENCY.browser,maxLead:L.PILOT.MAXLEAD.browser};
  let pos=-1;
  if(kind==='old'){
    const feed=new L.LegacySegFeed(),st={cand:-1,at:0};
    return{update(segs,now){
      const {commit,tail}=feed.update(segs);commit.forEach(c=>tr.commit(c));
      const e=tr.step(tail,false);const t=L.legacyDecide(e,pos,st,o,now);if(t>=0)pos=t;return pos;}};
  }
  const feed=new L.SegFeed(),pilot=new L.Pilot();
  return{update(segs,now){
    const {commit,tail,nw}=feed.update(segs);commit.forEach(c=>tr.commit(c));pilot.addHeard(nw);
    const e=tr.step(tail,false,pilot.est,pilot.contMax(now));const before=pilot.est,t=pilot.decide(e,pos,o,now);if(P.debug&&P.debug(now))console.log(JSON.stringify({T:+now.toFixed(1),tail:tail.length,heard:pilot.heard,pos:e.pos,conf:+e.conf.toFixed(2),loc:+e.local.toFixed(2),lp:e.locPos,lc:+e.locConf.toFixed(2),fit:+e.fit.toFixed(2),est:before,cur:pos,dec:t}));if(t>=0){pilot.moved(pos,t,now);pos=t;}return pos;}};
}
function run(kind,P,seeds=30){
  let n=0,w3=0,errSum=0,errN=0,over=0,hangS=0,total=0,bigMoves=0,maxErr=0,backSteps=0,leaps=0,ahead2=0,behind3=0,span=0;const rec=[],stallRec=[];
  for(let s=1;s<=seeds;s++){
    const sc=scenario(s*7919,P),pipe=makePipe(kind,sc,P),state={copies:{}};
    const rows=[];
    for(const T of sc.ups){
      const segs=listAt(sc,T,P,state);if(!segs.length)continue;
      const pos=pipe.update(segs,T);
      let k=-1;for(let m=0;m<sc.tw.length;m++){if(sc.tw[m]<=T)k=m;else break;}
      if(k<0||T>sc.tw[sc.tw.length-1]+1)continue;
      rows.push({T,err:pos-sc.spoken[k],pos});
    }
    let hang=0;
    let prevErrPos=null;span+=rows.length?rows[rows.length-1].T-rows[0].T:0;
    rows.forEach((x,j)=>{n++;if(x.err>=2&&x.err<=15)ahead2++;if(x.err<=-3&&x.err>=-15)behind3++;if(j>0&&!sc.jumpT.some(tj=>x.T>tj&&x.T-tj<7)){const dd=x.pos-rows[j-1].pos;if(dd<0&&dd>=-12)backSteps++;if(dd>3&&dd<=15)leaps++;}maxErr=Math.max(maxErr,Math.abs(x.err));if(j>0&&x.pos!==rows[j-1].pos&&Math.abs(x.err)-Math.abs(rows[j-1].err)>15&&!sc.jumpT.some(tj=>x.T>tj&&x.T-tj<7))bigMoves++;prevErrPos=x.pos;if(Math.abs(x.err)<=3)w3++;if(Math.abs(x.err)<=20){errSum+=x.err;errN++;}if(x.err>3)over++;
      const nearJump=sc.jumpT.some(tj=>x.T>tj&&x.T-tj<5);
      if(Math.abs(x.err)>15&&!nearJump){hang++;if(j&&true)hangS+=(x.T-rows[j-1].T);}
    });
    total+=rows.length?rows[rows.length-1].T-rows[0].T:0;
    if(P.stall){const te=P.stall[1]+P.delay;for(let q=0;q<rows.length-2;q++){if(rows[q].T<te)continue;if([0,1,2].every(z=>Math.abs(rows[q+z].err)<=4)){stallRec.push(rows[q].T-te);break;}if(rows[q].T-te>20){stallRec.push(20);break;}}}
    for(const tj of sc.jumpT){let got=-1;for(let q=0;q<rows.length-2;q++){if(rows[q].T<tj)continue;if([0,1,2].every(z=>Math.abs(rows[q+z].err)<=4)){got=rows[q].T-tj;break;}if(rows[q].T-tj>10)break;}rec.push(got<0?10:got);}
  }
  rec.sort((a,b)=>a-b);
  return{within3:(100*w3/n).toFixed(1)+'%',meanLagWords:(errSum/Math.max(1,errN)).toFixed(2),ahead3:(100*over/n).toFixed(1)+'%',hung:(100*hangS/total).toFixed(1)+'% of time',recovMed:(rec.length?rec[Math.floor(rec.length/2)]:0).toFixed(1)+'s',recovFail:rec.filter(x=>x>=10).length+'/'+rec.length,wrongLeaps:bigMoves,maxErr,'backSteps/100s':(100*backSteps/span).toFixed(1),'leaps>3/100s':(100*leaps/span).toFixed(1),aheadTime:(100*ahead2/n).toFixed(1)+'%',behindTime:(100*behind3/n).toFixed(1)+'%',stallRecovMed:stallRec.length?stallRec.sort((a,b)=>a-b)[Math.floor(stallRec.length/2)].toFixed(1)+'s':'-'};
}
const base=Object.assign({jump:.004,skip:.03,del:.06,sub:.12,ins:.04,delay:1.0,agg:50,lead:.7,shape:'steady'},OPT.p||{});
const shapes=OPT.shapes||['steady','burst','dup','reset'];
for(const shape of shapes){
  console.log('== engine shape:',shape);
  for(const kind of (OPT.kinds||['old','v16','new'])){const t0=Date.now();const x=run(kind,Object.assign({},base,{shape}));console.log(' ',kind.padEnd(4),JSON.stringify(x).replace(/"/g,''),Date.now()-t0+'ms');}
}
