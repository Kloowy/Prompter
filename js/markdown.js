/* markdown.js: tiny Markdown parser. Pure functions, no DOM (also loaded by tests/run.js).
   mdParse(text)   -> block nodes: {type:'h'|'p'|'li'|'code'|'table'|'hr', ...}
   mdInline(text)  -> pieces [{t, f}] where f is a bitmask of F_* styles
   mdTokens(pieces)-> words [{pieces:[{t,f}], sep}] (a word can contain several styled pieces)
   mdDetect(text)  -> true if the text looks like Markdown */
const F_B=1,F_I=2,F_C=4,F_S=8,F_A=16;   // bold, italic, code, strike, link

function mdCloser(s,c,n,from){
  for(let j=from;j<s.length;){
    if(s[j]==='\\'){j+=2;continue;}
    if(s[j]===c){
      let k=1;while(s[j+k]===c)k++;
      // a longer run closes too (**b *c*** ends *c* and **): the closer is its last n chars
      if((k===n||(k>n&&k<=3))&&!/\s/.test(s[j-1]||' ')&&(c!=='_'||!/[\p{L}\p{N}]/u.test(s[j+k]||'')))return j+k-n;
      j+=k;continue;
    }
    j++;
  }
  return -1;
}
function mdInline(src){
  const out=[];
  (function rec(s,f){
    let buf='',i=0;
    const flush=()=>{if(buf){out.push({t:buf,f});buf='';}};
    while(i<s.length){
      const c=s[i];
      if(c==='\\'&&i+1<s.length&&/[\\`*_{}\[\]()#+\-.!~|>]/.test(s[i+1])){buf+=s[i+1];i+=2;continue;}
      if(c==='`'){
        let n=1;while(s[i+n]==='`')n++;
        const j=s.indexOf('`'.repeat(n),i+n);
        if(j!==-1){flush();out.push({t:s.slice(i+n,j).trim(),f:f|F_C});i=j+n;continue;}
        buf+=s.slice(i,i+n);i+=n;continue;
      }
      if(c==='!'&&s[i+1]==='['){   // images are dropped (nothing to say out loud)
        const m=/^!\[[^\]]*\]\([^)]*\)/.exec(s.slice(i));
        if(m){i+=m[0].length;continue;}
      }
      if(c==='['){
        const m=/^\[((?:[^\[\]\\]|\\.)*)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/.exec(s.slice(i));
        if(m){flush();rec(m[1],f|F_A);i+=m[0].length;continue;}
      }
      if(c==='*'||c==='_'||c==='~'){
        let n=1;while(s[i+n]===c)n++;
        const ok=c==='~'?n===2:n<=3;
        if(ok&&i+n<s.length&&!/\s/.test(s[i+n])&&(c!=='_'||!/[\p{L}\p{N}]/u.test(s[i-1]||''))){
          const j=mdCloser(s,c,n,i+n);
          if(j>0){
            flush();
            rec(s.slice(i+n,j),f|(c==='~'?F_S:n===1?F_I:n===2?F_B:F_B|F_I));
            i=j+n;continue;
          }
        }
        buf+=s.slice(i,i+n);i+=n;continue;
      }
      buf+=c;i++;
    }
    flush();
  })(src,0);
  return out;
}
function mdTokens(pieces){
  const toks=[];let cur=null;
  for(const p of pieces){
    for(const x of p.t.split(/(\s+)/)){
      if(!x)continue;
      if(/^\s+$/.test(x)){cur=null;continue;}
      if(!cur){cur={pieces:[],sep:' '};toks.push(cur);}
      cur.pieces.push({t:x,f:p.f});
    }
  }
  return toks;
}
const plainTokens=line=>line.split(/\s+/).filter(Boolean).map(t=>({pieces:[{t,f:0}],sep:' '}));
/* code blocks keep their original whitespace (indentation, line breaks) */
function codeTokens(text){
  const out=[],re=/(\S+)(\s*)/g;let m;
  while((m=re.exec(text)))out.push({pieces:[{t:m[1],f:0}],sep:m[2]||' '});
  return out;
}

const RE_HR=/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_FENCE=/^\s{0,3}(`{3,}|~{3,})/;
const RE_ATX=/^\s{0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RE_LI=/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_QUOTE=/^\s{0,3}>/;
const RE_TSEP=/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow=l=>{
  l=l.trim().replace(/^\|/,'').replace(/\|$/,'');
  return l.split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
};
function mdBlocks(lines,q){
  const out=[];let i=0,para=[],stack=[];
  const flush=()=>{if(para.length){out.push({type:'p',text:para.join(' '),q});para=[];}};
  const startsBlock=l=>RE_FENCE.test(l)||RE_ATX.test(l)||RE_HR.test(l)||RE_QUOTE.test(l)||RE_LI.test(l);
  while(i<lines.length){
    const ln=lines[i];
    if(!ln.trim()){flush();i++;continue;}
    let m=RE_FENCE.exec(ln);
    if(m){
      flush();stack=[];
      const ch=m[1][0],len=m[1].length,body=[];i++;
      while(i<lines.length&&!new RegExp('^\\s{0,3}\\'+ch+'{'+len+',}\\s*$').test(lines[i])){body.push(lines[i]);i++;}
      i++;out.push({type:'code',text:body.join('\n'),q});continue;
    }
    if((m=RE_ATX.exec(ln))){flush();stack=[];out.push({type:'h',level:m[1].length,text:m[2]||'',q});i++;continue;}
    if(RE_HR.test(ln)){flush();stack=[];out.push({type:'hr'});i++;continue;}
    if(RE_QUOTE.test(ln)){
      flush();stack=[];const inner=[];
      while(i<lines.length&&lines[i].trim()&&RE_QUOTE.test(lines[i])){inner.push(lines[i].replace(/^\s{0,3}>\s?/,''));i++;}
      out.push(...mdBlocks(inner,q+1));continue;
    }
    if((m=RE_LI.exec(ln))){
      flush();
      const n=m[1].replace(/\t/g,'    ').length;
      while(stack.length&&stack[stack.length-1]>n)stack.pop();
      if(!stack.length||stack[stack.length-1]<n)stack.push(n);
      const level=Math.min(stack.length-1,3);
      let text=m[3];const ordered=/\d/.test(m[2]);
      const marker=ordered?m[2]:['•','◦','▪','▪'][level];
      let task=null;const tm=/^\[([ xX])\]\s+(.*)$/.exec(text);
      if(tm){task=tm[1]===' '?'todo':'done';text=tm[2];}
      i++;
      while(i<lines.length&&lines[i].trim()&&!startsBlock(lines[i])&&/^\s+\S/.test(lines[i])){text+=' '+lines[i].trim();i++;}
      out.push({type:'li',level,marker,text,task,q});continue;
    }
    if(ln.includes('|')&&i+1<lines.length&&RE_TSEP.test(lines[i+1])&&lines[i+1].includes('-')){
      flush();stack=[];
      const rows=[splitRow(ln)];i+=2;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')){rows.push(splitRow(lines[i]));i++;}
      out.push({type:'table',rows,head:true,q});continue;
    }
    // setext heading: a text line underlined with === or ---
    if(!para.length&&i+1<lines.length&&/^\s{0,3}(=+|-{2,})\s*$/.test(lines[i+1])){
      out.push({type:'h',level:lines[i+1].trim()[0]==='='?1:2,text:ln.trim(),q});stack=[];i+=2;continue;
    }
    para.push(ln.trim());stack=[];i++;
  }
  flush();return out;
}
function mdParse(src){
  src=src.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
         .replace(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/,'')      // YAML front matter
         .replace(/<!--[\s\S]*?-->/g,'');                    // comments
  return mdBlocks(src.split('\n'),0);
}
function mdDetect(t){
  if(/^\s{0,3}#{1,6}\s+\S/m.test(t))return true;
  let s=0;
  if((t.match(/^\s*([-*+]|\d+[.)])\s+\S/gm)||[]).length>=2)s++;
  if(/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(t))s++;
  if(/^\s*```/m.test(t))s++;
  if(/^\s{0,3}>\s?\S/m.test(t))s++;
  if(/\[[^\]\n]+\]\([^)\s]+\)/.test(t))s++;
  if(/^\s*\|.*\|\s*\n\s*\|?\s*:?-{2,}/m.test(t))s++;
  return s>=2;
}
