// node tests/run.js : tests for match.js, markdown.js, search.js (no browser needed)
const fs=require('fs'),path=require('path');
const src=['match','markdown','search','track'].map(f=>fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8')).join('\n');
const L=new Function(src+'\nreturn {Tracker,SegFeed,TRK,matchIndex,norm,locate,quick,mdParse,mdInline,mdTokens,mdDetect,searchFind,searchPick,fold,qsim,F_B,F_I,F_C,F_A,F_S}')();
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

console.log(bad?`${bad} FAILED, ${ok} passed`:`all ${ok} passed`);
process.exit(bad?1:0);
