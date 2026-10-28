/* engine-local.js: on-device speech recognition (Vosk = Kaldi compiled to WebAssembly).
   + works offline, no audio leaves the phone
   + low latency: partial words appear ~0.2-0.4 s after they are spoken (cloud recognition is ~1 s)
   + the recognizer is RESTRICTED to the words of your script (plus [unk]), which makes it far more accurate for
     scripted reading, also with a foreign accent: it can only "hear" words that are actually in the text.
   One model file per language lives in models/ (see README). Languages without a model use the browser engine. */
const LOCAL_MODELS={   // language code (first part of the dropdown value) -> model file in models/ (fetched by tools/get-models.py)
  en:'models/en-us.tar.gz',de:'models/de.tar.gz',fr:'models/fr.tar.gz',es:'models/es.tar.gz',
  it:'models/it.tar.gz',pt:'models/pt.tar.gz',tr:'models/tr.tar.gz'
};   // a language whose file is missing simply falls back to the browser engine
const localModelFor=lang=>LOCAL_MODELS[(lang||'').split('-')[0].toLowerCase()]||null;

let _voskLoading=null;
function loadVoskLib(){
  if(window.Vosk)return Promise.resolve();
  if(_voskLoading)return _voskLoading;
  return _voskLoading=new Promise((ok,bad)=>{
    const s=document.createElement('script');s.src='vendor/vosk.js';
    s.onload=()=>window.Vosk?ok():bad(new Error('vosk missing'));s.onerror=()=>bad(new Error('could not load vosk.js'));
    document.head.appendChild(s);
  });
}
/* download the model once (with progress), keep it in Cache Storage, hand the worker a blob: URL */
async function modelBlobURL(url,onProgress){
  const cache=await caches.open('prompter-models');
  let res=await cache.match(url);
  if(!res){
    const r=await fetch(url);
    if(!r.ok)throw new Error('model download failed ('+r.status+')');
    const total=+r.headers.get('content-length')||0,rd=r.body.getReader(),parts=[];let got=0;
    for(;;){const {done,value}=await rd.read();if(done)break;parts.push(value);got+=value.length;if(onProgress&&total)onProgress(got/total);}
    await cache.put(url,new Response(new Blob(parts)));
    res=await cache.match(url);
  }
  return URL.createObjectURL(await res.blob());
}
const modelPromises={};
function loadLocalModel(url,onProgress){
  return modelPromises[url]||(modelPromises[url]=(async()=>{
    await loadVoskLib();
    const blobUrl=await modelBlobURL(url,onProgress);
    const m=await Vosk.createModel(blobUrl);
    try{m.setLogLevel(-2);}catch(_){}
    return m;
  })().catch(e=>{delete modelPromises[url];throw e;}));
}
/* downsample a Float32 chunk to 16 kHz (the model's rate) by linear interpolation */
function to16k(buf,from){
  if(from===16000)return buf;
  const ratio=from/16000,n=Math.floor(buf.length/ratio),out=new Float32Array(n);
  for(let i=0;i<n;i++){const x=i*ratio,i0=Math.floor(x),f=x-i0;out[i]=buf[i0]*(1-f)+(buf[Math.min(buf.length-1,i0+1)])*f;}
  return out;
}
class LocalEngine{
  constructor(){this.model=null;this.rec=null;this.ctx=null;this.stream=null;this.node=null;this.running=false;}
  /* words: script words to restrict the recognizer to (lowercase, apostrophes kept) */
  async start(lang,words,h){
    const url=localModelFor(lang);if(!url)throw new Error('no local model for '+lang);
    this.model=await loadLocalModel(url,h.onProgress);
    const vocab=[...new Set(words)].filter(w=>w&&w!=="'");
    const grammar=vocab.length?JSON.stringify([vocab.join(' '),'[unk]']):undefined;
    this.rec=new this.model.KaldiRecognizer(16000,grammar);
    this.rec.on('partialresult',m=>{const p=m.result&&m.result.partial;if(this.running)h.onPartial(p||'');});
    this.rec.on('result',m=>{const t=m.result&&m.result.text;if(this.running)h.onFinal(t||'');});
    this.rec.on('error',m=>h.onError&&h.onError(m.error));
    this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:true,autoGainControl:true,channelCount:1}});
    let ctx;try{ctx=new AudioContext({sampleRate:16000});}catch(_){ctx=new AudioContext();}
    this.ctx=ctx;await ctx.resume();
    const src=ctx.createMediaStreamSource(this.stream);
    const feed=chunk=>{if(!this.running)return;try{this.rec.acceptWaveformFloat(to16k(chunk,ctx.sampleRate),16000);}catch(e){h.onError&&h.onError(String(e));}};
    if(ctx.audioWorklet){
      await ctx.audioWorklet.addModule('js/mic-worklet.js');
      this.node=new AudioWorkletNode(ctx,'mic-chunker');
      this.node.port.onmessage=e=>feed(e.data);
    }else{   // very old browsers
      this.node=ctx.createScriptProcessor(2048,1,1);
      this.node.onaudioprocess=e=>feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    const mute=ctx.createGain();mute.gain.value=0;   // keeps the graph "pulled" without playing the mic back
    src.connect(this.node);this.node.connect(mute);mute.connect(ctx.destination);
    this.running=true;
  }
  stop(){
    this.running=false;
    try{this.node&&this.node.disconnect();}catch(_){}
    try{this.stream&&this.stream.getTracks().forEach(t=>t.stop());}catch(_){}
    try{this.ctx&&this.ctx.close();}catch(_){}
    try{this.rec&&this.rec.remove&&this.rec.remove();}catch(_){}
    this.node=this.stream=this.ctx=this.rec=null;
  }
}
