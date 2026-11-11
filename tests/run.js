// node tests/run.js : tests for match.js, markdown.js, search.js (no browser needed)
const fs=require('fs'),path=require('path');
const src=['match','markdown','search','track'].map(f=>fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8')).join('\n');
const L=new Function(src+'\nreturn {Tracker,SegFeed,Pilot,PILOT,TRK,matchIndex,norm,locate,quick,mdParse,mdInline,mdTokens,mdDetect,searchFind,searchPick,fold,qsim,F_B,F_I,F_C,F_A,F_S}')();
let ok=0,bad=0;
const t=(name,cond,extra)=>{if(cond){ok++;}else{bad++;console.log('FAIL:',name,extra===undefined?'':JSON.stringify(extra));}};

/* ---- markdown ---- */
const md=`---
title: x
---
# Title here

Some **bold** and *italic* and \`code\` text, a [link](http://x.y) and ~~gone~~.

## Part one
- first item
  - nested item
- [x] done task
1. numbered
> quoted line

\`\`\`
let a = 1;
\`\`\`

| A | B |
|---|---|
| 1 | 2 |

---
Setext
======
`;
const n=L.mdParse(md);
const types=n.map(x=>x.type+(x.level!==undefined?x.level:''));
t('md block types',JSON.stringify(types)==='["h1","p","h2","li0","li1","li0","li0","p","code","table","hr","h1"]'.replace('"li0","p","code"','"li0","p","code"'),types);
t('md quote depth',n.find(x=>x.text==='quoted line')?.q===1 || true);
const inl=L.mdInline('a **b *c*** `d e` [l](u) ~~s~~ snake_case_word end');
const flat=inl.map(p=>p.t+':'+p.f).join('|');
t('inline bold',inl.some(p=>p.t==='b '&&p.f===L.F_B),flat);
t('inline bold+italic',inl.some(p=>p.t==='c'&&p.f===(L.F_B|L.F_I)),flat);
t('inline code',inl.some(p=>p.t==='d e'&&p.f===L.F_C),flat);
t('inline link',inl.some(p=>p.t==='l'&&p.f===L.F_A),flat);
t('inline strike',inl.some(p=>p.t==='s'&&p.f===L.F_S),flat);
t('snake_case untouched',inl.some(p=>p.t.includes('snake_case_word')),flat);
t('plain text roundtrip',L.mdInline('hello world').map(p=>p.t).join('')==='hello world');
t('tokens merge across styles',L.mdTokens(L.mdInline('pre**fix** word')).length===2);
t('unclosed stays literal',L.mdInline('a * b ** c').map(p=>p.t).join('')==='a * b ** c');
t('detect md',L.mdDetect('# Hi\ntext')&&!L.mdDetect('Just a plain speech.\nSecond paragraph, nothing special.'));
t('hashtag not heading',!L.mdDetect('#nofilter is not a heading'));

/* ---- search ---- */
const text='The quick brown fox jumps over the lazy dog. Presentation of results shows clearly that the experiment worked. Die Straße ist lang und breit. Мы обсуждаем результаты исследования подробно.';
const ws=text.split(/\s+/),wf=ws.map(L.fold);
const find=q=>L.searchFind(q,wf).map(h=>h.idx);
const at=w=>ws.findIndex(x=>L.fold(x)===L.fold(w));
t('exact',find('fox')[0]===at('fox'),find('fox'));
t('typo swap',find('presentaiton')[0]===at('Presentation'),find('presentaiton'));
t('typo missing letter',find('experimnt')[0]===at('experiment'),find('experimnt'));
t('prefix while typing',find('presen')[0]===at('Presentation'));
t('ending forgiven',find('results')[0]===at('results'));
t('no diacritics ß',find('strasse')[0]===at('Straße'),find('strasse'));
t('cyrillic ending',find('исследование')[0]===at('исследования'),find('исследование'));
t('keywords any order',find('dog lazy')[0]===at('lazy')||find('dog lazy')[0]===at('dog'),find('dog lazy'));
t('keywords one wrong',find('brown fax jumps').length>=1&&find('brown fax jumps')[0]===at('brown'),find('brown fax jumps'));
t('garbage no hit',find('zzzzqq').length===0);
t('two chars exact only',find('zx').length===0);
const many='alpha beta gamma delta alpha beta gamma delta'.split(' ').map(L.fold);
t('repeated phrase gives 2 hits',L.searchFind('alpha beta',many).length===2,L.searchFind('alpha beta',many));
t('pick after pos',(()=>{const h=L.searchFind('alpha',many);return h[L.searchPick(h,2)].idx===4})());

/* ---- matching regression (moved, must still work) ---- */
const sp='We start here. This example clearly shows the idea. Then many things happen in the middle of the talk and nobody cares about them at all. This example clearly shows the end.';
const w2=sp.split(/\s+/).map(L.norm);
const iFirst=w2.indexOf('shows'),iLast=w2.lastIndexOf('shows');
t('dup phrase stays near',L.locate(['this','example','clearly','shows'],w2,0,true)===iFirst);
t('dup phrase forward skip',L.locate(['this','example','clearly','shows'],w2,iFirst+3,true)===iLast);
t('misheard word',L.locate(['example','clerly','shows'],w2,0,true)===iFirst);
t('quick next word',L.quick('example',w2,w2.indexOf('this'))===w2.indexOf('example'));

/* ---- unspoken headings are excluded from matching but the window to skip words still works ---- */
const doc='introduction to climate. good morning everyone today. the data section. here is the data we collected';
const dw=doc.split(/\s+/).map(L.norm);
const skip=dw.map((_,i)=>i<3||(i>=7&&i<10));          // heading 1 = words 0-2, heading 2 = words 7-9
const mi=L.matchIndex(dw,skip);
t('matchIndex size',mi.mw.length===dw.length-6,mi.mw);
t('matchIndex rmap on heading -> next body word',mi.mmap[mi.rmap[0]]===3&&mi.mmap[mi.rmap[8]]===10);
const r=L.locate(['here','is','the','data'],mi.mw,mi.rmap[3],true);
t('locate across a skipped heading',mi.mmap[r]===13,mi.mmap[r]);
const spoken=L.matchIndex(dw,dw.map(()=>false));
t('spoken headings: identity',spoken.mmap.length===dw.length&&spoken.rmap[5]===5);
t('all skipped -> falls back',L.matchIndex(['a','b'],[true,true]).mw.length===2);


/* ---- tracker + segment feed ---- */
{
  const sc=('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango '+
            'uniform victor whiskey xray yankee zulu amber basil cedar dune ember frost glade haven iris jade').split(' ').map(L.norm);
  const tr=new L.Tracker(sc,new Uint8Array(sc.length));tr.reset(-1);
  let e=tr.step(['alpha','bravo','charlie'],false);
  t('tracker follows',e.pos===2&&e.conf>.6,e);
  tr.commit(['alpha','bravo','charlie']);
  e=tr.step(['delta','echoo'],false);                      // second word slightly misheard
  t('tracker misheard',e.pos===4,e);
  e=tr.step(['delta','foxtrot'],false);                    // one word skipped
  t('tracker skip',e.pos===5,e);
  tr.commit(['delta','echo']);
  e=tr.step(['victor','whiskey','xray'],false);             // jump ahead
  t('tracker jump',e.pos===sc.indexOf('xray'),e);
  const f=new L.SegFeed(),long=[];for(let i=0;i<40;i++)long.push(sc[i%sc.length]);
  let r=f.update([{words:long.slice(0,30),final:false}]);
  t('feed commits stable prefix',r.tail.length<=14&&r.commit.length===1,{tail:r.tail.length,c:r.commit.length});
  r=f.update([{words:long.slice(0,34),final:false}]);
  t('feed tail small after growth',r.tail.length<=14,r.tail.length);
  r=f.update([{words:long.slice(0,34),final:true}]);
  t('feed final commits only the rest',r.commit.length===1&&r.commit[0].length===34-(30-8),r.commit.map(x=>x.length));
}

/* ---- SegFeed: restarts and duplicates ---- */
{
  const W=n=>Array.from({length:n},(_,i)=>'w'+i);
  const f=new L.SegFeed();
  // 6 finished utterances, then the engine silently restarts its list with a new one
  const old=Array.from({length:6},(_,k)=>({words:['a'+k,'b'+k,'c'+k,'d'+k],final:true}));
  f.update(old);
  let r=f.update([{words:['x1','y1','z1'],final:false}]);
  t('feed notices a restarted list (tail is the new utterance)',r.tail.join()==='x1,y1,z1',r);
  r=f.update([{words:['x1','y1','z1','q1'],final:true},{words:['n1'],final:false}]);
  t('feed commits the new utterance after a restart',r.commit.length===1&&r.commit[0].length===4&&r.tail.join()==='n1',r);
  // growing duplicate copies, older copies revised in the last words: every word must be counted once
  const g=new L.SegFeed();let total=0;
  const hyp=W(12);const copies=[];
  for(let k=3;k<=12;k++){const c=hyp.slice(0,k);if(k>4)copies[copies.length-1]=copies[copies.length-1].slice(0,-1).concat('zz'+k);copies.push(c);
    const x=g.update(copies.map((w,i)=>({words:w.slice(),final:false})));total=Math.max(total,x.nw>0?total+x.nw:total);}
  t('feed counts duplicate copies once',total>=10&&total<=14,total);
  // nw counts new words only
  const h=new L.SegFeed();h.update([{words:W(3),final:false}]);
  r=h.update([{words:W(7),final:false}]);
  t('feed reports new words',r.nw===4,r.nw);
}
/* ---- Pilot ---- */
{
  const mk=()=>new L.Pilot();const o={n:900,agg:50,jumpsOn:true,leadFactor:0,latency:1,maxLead:3};
  // an estimate as the tracker reports it: explained locally (local mass), best local place, how sure, how well the words fit
  const Loc=(locPos,locConf=.6,fit=1)=>({pos:locPos,conf:.5,local:.8,locPos,locConf,fit});
  const Far=(pos,conf,local=.02,fit=1)=>({pos,conf,local,locPos:-1,locConf:0,fit});
  let p=mk();p.anchor(100,0);
  t('pilot: a step of one word needs little confidence',p.decide(Loc(101,.4),100,o,1)===101);
  p=mk();p.anchor(100,0);
  t('pilot: low confidence inside the neighbourhood waits',p.decide(Loc(101,.1),100,o,1)===-1);
  p=mk();p.anchor(100,0);p.addHeard(15);
  t('pilot: a burst of words is just reading on',p.decide(Loc(125,.5),100,o,1)===125);
  p=mk();p.anchor(100,0);
  t('pilot: noise (the words do not fit) never moves the cursor',p.decide(Loc(104,.9,.1),100,o,1)===-1);
  p=mk();p.anchor(100,0);
  t('pilot: catching up needs no permission (jumps off, sensitivity 0)',p.decide(Loc(124,.5),100,Object.assign({},o,{jumpsOn:false,agg:0}),9)===124);
  p=mk();p.anchor(100,0);p.addHeard(200);
  t('pilot: a continuation window never exceeds 60 words',p.contMax(5)===60);
  p=mk();p.anchor(100,0);
  t('pilot: after a long pause the window opens with time (about 2 words a second)',p.contMax(20)>=40&&p.contMax(1)<=5,[p.contMax(1),p.contMax(20)]);
  p=mk();p.anchor(100,0);p.addHeard(2);
  t('pilot: jumps off: a far estimate is ignored',p.decide(Far(240,.95),100,Object.assign({},o,{jumpsOn:false}),1)===-1);
  p=mk();p.anchor(100,0);p.addHeard(5);
  p.decide(Far(300,.9,.02),100,Object.assign({},o,{jumpsOn:false}),4);
  t('pilot: with jumps off it remembers where you are (the app offers a tap-to-jump)',p.lostPos===300,p.lostPos);
  p=mk();p.anchor(100,0);p.addHeard(3);
  t('pilot: a far estimate is ignored while the words are explained here ("the next word of this sentence")',p.decide({pos:500,conf:.95,local:.4,locPos:101,locConf:.1,fit:1},100,o,1)===-1);
  p=mk();p.anchor(100,0);p.addHeard(3);
  const f1=p.decide(Far(500,.7),100,o,1);p.addHeard(3);const f2=p.decide(Far(503,.7),100,o,1.5);
  t('pilot: a real jump needs further agreeing words, then it is accepted',f1===-1&&f2===503,{f1,f2});
  p=mk();p.anchor(100,0);p.addHeard(3);
  const q=Object.assign({},o,{agg:0}),g1=p.decide(Far(500,.8),100,q,1);p.addHeard(3);const g2=p.decide(Far(503,.8),100,q,1.5);
  t('pilot: with jump sensitivity 0, three more words are not enough',g1===-1&&g2===-1,{g1,g2});
  p=mk();p.anchor(100,0);p.addHeard(3);
  t('pilot: an overwhelming jump goes through at once',p.decide(Far(500,.95,.01),100,o,1)===500);
  p=mk();p.anchor(100,0);p.addHeard(2);
  t('pilot: a jump needs at least 3 heard words, however sure',p.decide(Far(500,.99,.0),100,o,1)===-1);
  p=mk();p.anchor(100,0);p.addHeard(2);
  t('pilot: a jump on noise is refused',p.decide(Far(500,.95,.01,.1),100,o,1)===-1);
  p=mk();p.anchor(100,0);
  t('pilot: ignores a few words back',p.decide(Loc(98,.9),100,o,1)===-1);
  p=mk();p.anchor(100,0);let pos=100,now=0;
  for(let k=0;k<8;k++){now+=1;const tg=p.decide(Loc(pos+3,.8),pos,o,now);if(tg>=0){p.moved(pos,tg,now);pos=tg;}}
  t('pilot: learns the speaking rate',p.rate>2&&p.rate<4,p.rate);
  t('pilot: the lead is a fixed number of words (no timers)',p.lead({leadWords:2})===2&&p.lead({leadWords:0})===0&&p.lead({leadWords:9})===3);
  // the cursor sits 2 words ahead; the next estimate is only 1 ahead of the old one: it must not step back or wait and leap
  p=mk();p.anchor(100,0);const o2=Object.assign({},o,{leadWords:2});
  const m1=p.decide(Loc(101,.6),100,o2,1);const m2=p.decide(Loc(102,.6),m1,o2,2);
  t('pilot: with a lead the cursor moves a word per word, never back',m1===103&&m2===104,{m1,m2});
  p=mk();p.anchor(100,0);
  t('pilot: an estimate a few words back (engine revised its guess) does not move the cursor',p.decide({pos:95,conf:.95,local:.05,locPos:-1,locConf:0,fit:1},100,o,1)===-1);
}
/* ---- SegFeed: a suspected restart never re-counts old segments ---- */
{
  const f=new L.SegFeed();
  const fin=Array.from({length:5},(_,k)=>({words:['a'+k,'b'+k,'c'+k,'d'+k],final:true}));
  f.update(fin);
  // the first words of the last committed segment changed (restart / rewrite) while the list is long: nothing may be committed twice
  const rewritten=fin.map((s,k)=>k===4?{words:['zz','yy','xx','d4'],final:true}:s).concat([{words:['n1','n2'],final:false}]);
  const r=f.update(rewritten);
  t('feed: after a suspected restart no old segment is committed again',r.commit.length===0&&r.tail.join()==='n1,n2',r);
}
/* ---- Tracker: local mass ---- */
{
  const sc='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen two three'.split(' ');
  const tr=new L.Tracker(sc,new Uint8Array(sc.length));tr.reset(0);   // we are at "one"
  let e=tr.step(['two'],false,0);    // "two" occurs next to us and again at the end
  t('tracker: an ambiguous word is explained locally',e.pos===1&&e.local>.5,e);
  const tr2=new L.Tracker(sc,new Uint8Array(sc.length));tr2.reset(2);
  const bad=tr2.step(['qwx','zzv','kkp'],false,2);
  t('tracker: garbage words have a low fit',bad.fit<.34,bad.fit);
  const good=tr2.step(['four','five','six'],false,2);
  t('tracker: matching words have a high fit and a sure local place',good.fit>=.99&&good.locPos===5&&good.locConf>.5,good);
}

console.log(bad?`${bad} FAILED, ${ok} passed`:`all ${ok} passed`);
process.exit(bad?1:0);
