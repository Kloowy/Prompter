/* mic-worklet.js: runs on the audio thread. Collects the microphone into ~100 ms chunks and hands them over.
   (AudioWorklet: no UI-thread jank, no dropped audio while the page scrolls.) */
class MicChunker extends AudioWorkletProcessor{
  constructor(){super();this.buf=new Float32Array(Math.round(sampleRate/10));this.n=0;}
  process(inputs){
    const ch=inputs[0]&&inputs[0][0];
    if(!ch)return true;
    for(let i=0;i<ch.length;i++){
      this.buf[this.n++]=ch[i];
      if(this.n===this.buf.length){this.port.postMessage(this.buf.slice(0));this.n=0;}
    }
    return true;
  }
}
registerProcessor('mic-chunker',MicChunker);
