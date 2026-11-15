/* search.js: in-app Ctrl+F that forgives typos, endings, missing diacritics and half-typed words.
   searchFind(query, wf) -> [{idx, score, words:[...]}] in text order, where wf = folded words of the text.
   Several words = keywords: they may come in any order within a short window of the text. */
const FOLD_MAP={'ß':'ss','ł':'l','ø':'o','đ':'d','ı':'i','æ':'ae','œ':'oe','þ':'th'};
function fold(s){
  return s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'')
    .replace(/[ßłøđıæœþ]/g,c=>FOLD_MAP[c]).replace(/[^\p{L}\p{N}]+/gu,'');
}
/* Damerau-Levenshtein (adjacent swaps cost 1: the classic phone-keyboard typo) */
function osa(a,b){
  const m=a.length,n=b.length,d=[];
  for(let i=0;i<=m;i++){d[i]=[i];}
  for(let j=1;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++){
    const c=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }
  return d[m][n];
}
/* similarity of a query word q to a text word t (both folded): 0 = no match */
function qsim(q,t){
  if(q===t)return 1;
  const ql=q.length,tl=t.length;
  if(ql<2||!tl)return 0;
  if(tl>=ql&&t.startsWith(q))return ql>=3?.92:.8;      // still typing the word
  if(ql>=4&&t.includes(q))return .75;                  // part of a longer word
  if(ql<3)return 0;
  let k=0;const m=Math.min(ql,tl);while(k<m&&q[k]===t[k])k++;
  if(k>=4&&k/Math.max(ql,tl)>=.6)return .85;           // same stem, different ending
  const maxD=ql<=3?0:ql<=5?1:ql<=8?2:3;
  if(!maxD||Math.abs(ql-tl)>maxD)return 0;
  const d=osa(q,t);
  return d<=maxD?.9-.12*d:0;
}
const SEARCH_MIN=.5,SEARCH_MAX=500;
function searchFind(query,wf){
  const qs=query.split(/\s+/).map(fold).filter(Boolean);
  const N=wf.length,k=qs.length;
  if(!k||!N)return [];
  const wt=qs.map(q=>Math.max(.4,Math.min(q.length,7)/7));
  const sc=qs.map(q=>{
    const cache=new Map(),a=new Float32Array(N);
    for(let i=0;i<N;i++){
      const t=wf[i];let v=cache.get(t);
      if(v===undefined){v=qsim(q,t);if(v<SEARCH_MIN)v=0;cache.set(t,v);}
      a[i]=v;
    }
    return a;
  });
  if(k===1){
    const out=[];
    for(let i=0;i<N&&out.length<SEARCH_MAX;i++)if(sc[0][i]>0)out.push({idx:i,score:sc[0][i],words:[i]});
    return out;
  }
  const W=Math.max(6,k*3),sumW=wt.reduce((a,b)=>a+b,0),need=Math.ceil(k*.6),cand=[];
  for(let a=0;a<N;a++){
    let any=false;for(let t=0;t<k;t++)if(sc[t][a]>0){any=true;break;}
    if(!any)continue;
    const end=Math.min(N,a+W);let total=0,mx=-1,mn=1e9,cnt=0,top=0;const ws=[];
    for(let t=0;t<k;t++){
      let best=0,bi=-1;
      for(let j=a;j<end;j++)if(sc[t][j]>best){best=sc[t][j];bi=j;}
      if(bi>=0){total+=wt[t]*best;cnt++;ws.push(bi);mx=Math.max(mx,bi);mn=Math.min(mn,bi);top=Math.max(top,best);}
    }
    if(cnt<need||top<.75)continue;
    const score=total/sumW-.012*(mx-mn);
    if(score>=SEARCH_MIN)cand.push({idx:mn,score,words:[...new Set(ws)]});
  }
  cand.sort((x,y)=>y.score-x.score);
  const acc=[];
  for(const c of cand){
    if(acc.length>=SEARCH_MAX)break;
    if(!acc.some(x=>Math.abs(x.idx-c.idx)<=k))acc.push(c);
  }
  return acc.sort((x,y)=>x.idx-y.idx);
}
/* which hit to show first: among the best-scoring ones, the first at/after the current position */
function searchPick(hits,pos){
  if(!hits.length)return -1;
  let best=0;for(const h of hits)if(h.score>best)best=h.score;
  const good=[];hits.forEach((h,i)=>{if(h.score>=best-.15)good.push(i)});
  const after=good.find(i=>hits[i].idx>=pos);
  return after!==undefined?after:good[0];
}
