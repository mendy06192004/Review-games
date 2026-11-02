G.audio = (function(){
  let ctx=null, master=null, muted=false, siren=null;
  function init(){
    if(ctx) return;
    try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); master=ctx.createGain(); master.gain.value=0.5; master.connect(ctx.destination);}catch(e){ctx=null}
  }
  function tone(freq,dur,type='square',vol=0.2,when=0,slide=0){
    if(!ctx||muted) return;
    const t=ctx.currentTime+when, o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slide) o.frequency.linearRampToValueAtTime(freq+slide,t+dur);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.02);
  }
  function noise(dur,vol=0.3){
    if(!ctx||muted) return;
    const b=ctx.createBuffer(1,ctx.sampleRate*dur,ctx.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
    const s=ctx.createBufferSource(), g=ctx.createGain(); g.gain.value=vol;
    s.buffer=b; s.connect(g); g.connect(master); s.start();
  }
  return {
    init,
    get muted(){return muted},
    toggle(){ muted=!muted; if(muted) this.sirenOff(); return muted; },
    whistle(){ // 嗶——嗶
      for(let i=0;i<2;i++){ const w=i*0.28;
        for(let k=0;k<6;k++) tone(2900+(k%2)*180,0.04,'sine',0.25,w+k*0.035); }
    },
    good(){ tone(660,0.1,'triangle',0.25); tone(990,0.18,'triangle',0.25,0.1); },
    bad(){ tone(180,0.35,'sawtooth',0.18); tone(140,0.4,'sawtooth',0.15,0.12); },
    click(){ tone(1200,0.03,'square',0.08); },
    flash(){ tone(3200,0.05,'square',0.06); },
    whoosh(){ noise(0.25,0.18); tone(500,0.2,'sine',0.08,0,-300); },
    boost(){ tone(220,0.5,'sawtooth',0.12,0,500); },
    cuff(){ tone(2200,0.03,'square',0.15); tone(1800,0.03,'square',0.15,0.07); tone(2400,0.03,'square',0.15,0.3); tone(1900,0.03,'square',0.15,0.37); },
    shot(){ noise(0.09,0.5); tone(160,0.12,'square',0.2,0,-90); },
    net(){ tone(700,0.25,'triangle',0.12,0,-450); noise(0.2,0.12); },
    alarm(){ for(let i=0;i<3;i++){ tone(1500,0.12,'square',0.07,i*0.25); tone(1100,0.12,'square',0.07,i*0.25+0.12); } },
    crash(){ noise(0.35,0.45); tone(90,0.25,'sine',0.3); },
    sirenOn(){
      if(!ctx||muted||siren) return;
      const o=ctx.createOscillator(), l=ctx.createOscillator(), lg=ctx.createGain(), g=ctx.createGain();
      o.type='sawtooth'; o.frequency.value=900; l.frequency.value=1.6; lg.gain.value=320;
      l.connect(lg); lg.connect(o.frequency); g.gain.value=0.07; o.connect(g); g.connect(master);
      o.start(); l.start(); siren={o,l,g};
    },
    sirenOff(){ if(siren){ try{siren.o.stop();siren.l.stop();}catch(e){} siren=null; } },
  };
})();
