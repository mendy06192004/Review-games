// 拒捕追逐戰：三車道街機式追逐 + 攔截壓制動畫
G.chase = (function(){
  const LANES=[-3.4,0,3.4];
  let scene, cam, dashes=[], blds=[], st=null, built=false;
  const {box,M}=G.M;
  const ease=t=>t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
  const lerp=(a,b,t)=>a+(b-a)*t;

  function build(){
    scene=new THREE.Scene(); scene.background=new THREE.Color('#9fc6e6'); scene.fog=new THREE.Fog('#b4d1ea',40,150);
    scene.add(new THREE.HemisphereLight('#eef6ff','#6f6a5e',0.9));
    const sun=new THREE.DirectionalLight('#fff1d6',0.7); sun.position.set(20,50,10); scene.add(sun);
    const g=new THREE.Mesh(new THREE.PlaneGeometry(200,400),M('#b0aa9c')); g.rotation.x=-Math.PI/2; g.position.z=-120; scene.add(g);
    const road=new THREE.Mesh(new THREE.PlaneGeometry(10.8,400),M('#3b3e45')); road.rotation.x=-Math.PI/2; road.position.set(0,0.01,-120); scene.add(road);
    for(const s of [-1,1]){ box(0.3,0.16,400,'#d6d2c8',s*5.5,0.08,-120,scene); box(0.14,0.02,400,'#f2c21b',s*5.1,0.02,-120,scene); }
    const dm=new THREE.MeshBasicMaterial({color:'#eceae2'});
    for(let z=10;z>-170;z-=6) for(const x of [-1.7,1.7]){ const d=new THREE.Mesh(new THREE.PlaneGeometry(0.14,2.4),dm); d.rotation.x=-Math.PI/2; d.position.set(x,0.03,z); scene.add(d); dashes.push(d); }
    for(const s of [-1,1]){ let z=20; while(z>-170){ const w=G.rand(6,10); const b=G.M.building(w); b.rotation.y=s<0?Math.PI/2:-Math.PI/2; b.position.set(s*9,0,z-w/2); b.userData.w=w; scene.add(b); blds.push(b); z-=w+0.1; } }
    for(let z=0;z>-170;z-=22) for(const s of [-1,1]){ const p=G.M.cyl(0.16,8,'#8f8b82',s*6.6,4,z,scene); p.userData.w=0.4; blds.push(p); }
    cam=new THREE.PerspectiveCamera(62,1,0.1,300);
    built=true;
  }

  function officer(){
    const p=G.M.person({head:'police',shirt:'#1d3f8a',pants:'#1a2340',skin:'#e0ac83'});
    box(0.52,0.42,0.32,new THREE.MeshLambertMaterial({color:'#c6f23a',emissive:'#3a4a00'}),0,1.2,0,p);
    return p;
  }

  function civilian(){
    const r=Math.random(); let m, len, speed;
    if(r<0.36){
      const t=G.pick(['cone','box','truck','scoot']);
      if(t==='cone'){ m=new THREE.Group(); G.M.cone(m,-0.5,0); G.M.cone(m,0.5,0.4); len=1.4; }
      else if(t==='box'){ m=G.M.transformer(null,0,0,0); len=1.2; }
      else if(t==='scoot'){ m=G.M.parkedScooters(null,-1.2,0,3); len=1.2; }
      else { m=G.M.car('truck'); m.rotation.y=Math.PI; len=4.8; }
      speed=0;
    } else if(r<0.68){ m=G.M.moto({riders:['helmet']}); m.rotation.y=Math.PI; len=2; speed=st.base*G.rand(0.38,0.55); }
    else { m=G.M.car(G.chance(0.3)?'taxi':'sedan'); m.rotation.y=Math.PI; len=4.4; speed=st.base*G.rand(0.32,0.5); }
    return {m,len,speed};
  }
  function addObj(m,lane,x,z,len,speed,extra){ m.position.set(x,0,z); scene.add(m); const o=Object.assign({m,lane,x,z,len,speed,aside:false},extra||{}); st.objs.push(o); return o; }
  function spawnObs(){
    const busy=new Set(st.objs.filter(o=>o.z<-125).map(o=>o.lane));
    const n=G.chance(0.22+Math.min(0.25,st.el*0.012))?2:1;
    const lanes=[0,1,2].filter(l=>!busy.has(l)).sort(()=>Math.random()-0.5).slice(0,n);
    for(const lane of lanes){ const c=civilian(); addObj(c.m,lane,LANES[lane],-150,c.len,c.speed); }
  }
  function drop(){ // 嫌犯往後丟東西
    const t=G.pick(['box','box','cone','tire','bento']); const m=new THREE.Group();
    if(t==='box'){ box(0.9,0.7,0.9,'#c8a26b',0,0.35,0,m); box(0.92,0.06,0.2,'#a07c48',0,0.71,0,m); }
    else if(t==='cone') G.M.cone(m,0,0);
    else if(t==='tire'){ G.M.cyl(0.45,0.3,'#1b1b1b',0,0.45,0,m,0,Math.PI/2); }
    else { box(0.9,0.5,0.7,'#f2f2f2',0,0.25,0,m); box(0.92,0.1,0.72,'#d32f2f',0,0.55,0,m); }
    m.rotation.y=Math.random()*3;
    addObj(m,st.tLane,st.tx,-st.dist+2.6,1.0,0,{dropped:true});
    pop(G.pick(['嫌犯丟紙箱擋路！','小心路障！','他把便當丟出來了！']),'bad');
  }
  function pop(text,kind){ st.pops.push({text,kind}); }

  function start(npc,onDone){
    if(!built) build();
    st={npc,onDone,base:30,pSpeed:30,dist:32,time:35,hp:3,lane:1,x:0,slow:0,siren:0,sirenCd:0,
        tLane:G.ri(0,2),tx:0,tTimer:1.5,objs:[],spawn:0.6,shake:0,hitFx:0,over:false,ready:false,anim:0,el:0,
        nitro:0.35,boost:0,dropT:G.rand(3,5),pops:[],phase:'chase',cap:null,people:[],
        tire:0,need:npc.kind==='moto'?2:3,tSlow:1,fireCd:0,fx:[],shots:0,hits:0,civHits:0,capDelay:-1,bestRun:0,run:0};
    st.tx=LANES[st.tLane];
    const tg=npc.group; tg.position.set(st.tx,0,-st.dist); tg.rotation.set(0,Math.PI,0); scene.add(tg); st.target=tg;
    st.player=G.M.car('police'); st.player.rotation.y=Math.PI; scene.add(st.player);
    cam.fov=62; cam.updateProjectionMatrix();
    if(!G.audio.muted) G.audio.sirenOn();
  }
  function end(result){
    if(st.over) return; st.over=true; G.audio.sirenOff();
    for(const o of st.objs) scene.remove(o.m);
    for(const p of st.people) scene.remove(p);
    for(const f of st.fx) scene.remove(f.m);
    scene.remove(st.target); scene.remove(st.player);
    const cb=st.onDone; setTimeout(()=>cb(result),10);
  }
  function scroll(sp,dt){
    for(const d of dashes){ d.position.z+=sp*dt; if(d.position.z>12) d.position.z-=180; }
    for(const b of blds){ b.position.z+=sp*dt; if(b.position.z-b.userData.w/2>25) b.position.z-=196; }
  }
  function lights(){
    const L=st.player.userData.lights; if(!L) return;
    const ph=Math.floor(st.anim*8)%2;
    L[0].emissive.set(ph?'#ff0000':'#330000'); L[1].emissive.set(ph?'#001033':'#0050ff');
  }

  function update(dt){
    if(!st||st.over) return;
    st.anim+=dt; lights();
    if(st.phase==='capture'){ capture(dt); return; }
    st.time-=dt; st.el+=dt;
    st.slow=Math.max(0,st.slow-dt); st.siren=Math.max(0,st.siren-dt); st.sirenCd=Math.max(0,st.sirenCd-dt);
    st.shake=Math.max(0,st.shake-dt); st.hitFx=Math.max(0,st.hitFx-dt); st.boost=Math.max(0,st.boost-dt);
    st.nitro=Math.min(1,st.nitro+dt*0.035); st.fireCd=Math.max(0,st.fireCd-dt);
    if(st.capDelay>0){ st.capDelay-=dt; if(st.capDelay<=0){ beginCapture(); return; } }
    st.base=30+Math.min(14,st.el*0.55);
    const pSpeed=st.base*(st.slow>0?0.45:1)*(st.boost>0?1.5:1); st.pSpeed=pSpeed;
    // 嫌犯 AI
    const tz=-st.dist; let tBlocked=false;
    st.tTimer-=dt;
    const threat=l=>st.objs.some(o=>!o.aside&&!o.dropped&&o.lane===l&&o.z<tz+1&&o.z>tz-16);
    if(threat(st.tLane)||st.tTimer<=0){
      const opts=[st.tLane-1,st.tLane+1].filter(l=>l>=0&&l<3&&!threat(l));
      if(opts.length) st.tLane=G.pick(opts); else if(threat(st.tLane)) tBlocked=true;
      st.tTimer=G.rand(0.9,2.2);
    }
    st.tx+=(LANES[st.tLane]-st.tx)*Math.min(1,dt*5);
    const tSpeed=st.base*(tBlocked?0.5:0.86)*st.tSlow*(1+Math.sin(st.anim*0.9)*0.07);
    st.dist+=(tSpeed-pSpeed)*dt; st.dist=Math.max(5.6,st.dist);
    st.dropT-=dt; if(st.dropT<=0){ if(st.dist>22&&st.dist<50) drop(); st.dropT=G.rand(2.6,4.6); }
    st.spawn-=dt*pSpeed/st.base; if(st.spawn<=0){ spawnObs(); st.spawn=G.rand(0.5,0.95)-Math.min(0.2,st.el*0.008); }
    for(const o of st.objs.slice()){
      o.z+=(pSpeed-o.speed)*dt;
      if(st.siren>0&&o.speed>0&&!o.aside&&o.z>-90&&o.z<2){ o.aside=true; o.ax=o.x<0?-4.6:o.x>0?4.6:(G.chance(0.5)?-4.6:4.6); }
      if(o.aside){ o.x+=(o.ax-o.x)*Math.min(1,dt*3); o.speed=Math.max(0,o.speed-st.base*dt*0.3); }
      if(o.hitT){ o.vy-=20*dt; o.m.position.y=Math.max(0,o.m.position.y+o.vy*dt); o.m.rotation.x+=dt*6; }
      o.m.position.x=o.x; o.m.position.z=o.z;
      if(!o.aside&&!o.hit&&Math.abs(o.x-st.x)<1.75&&Math.abs(o.z)<o.len/2+2.1){
        o.hit=true; o.hitT=1; o.vy=7; st.hp--; st.slow=1.2; st.shake=0.45; st.hitFx=0.5; st.boost=0; G.audio.crash();
        pop(st.hp>0?'撞到了！':'警車全毀！','bad');
        if(navigator.vibrate) try{navigator.vibrate(140)}catch(e){}
      }
      if(!o.hit&&!o.passed&&o.z>o.len/2+2.1){
        o.passed=true; const dx=Math.abs(o.x-st.x);
        if(!o.aside&&dx<4.4){ st.nitro=Math.min(1,st.nitro+0.22); pop(G.pick(['驚險閃過！','差一點！','神操作！']),'good'); G.audio.whoosh(); }
      }
      if(o.z>20){ scene.remove(o.m); st.objs.splice(st.objs.indexOf(o),1); }
    }
    st.x+=(LANES[st.lane]-st.x)*Math.min(1,dt*10);
    st.player.position.set(st.x,0,0); st.player.rotation.y=Math.PI-(LANES[st.lane]-st.x)*0.08;
    st.target.position.set(st.tx,0,-st.dist); st.target.rotation.y=Math.PI-(LANES[st.tLane]-st.tx)*0.1;
    scroll(pSpeed,dt);
    const sh=st.shake>0?(Math.random()-0.5)*0.7:0;
    const fov=60+(pSpeed-30)*0.7; cam.fov+=(fov-cam.fov)*Math.min(1,dt*4); cam.updateProjectionMatrix();
    cam.position.set(st.x*0.6+sh,4.6+(st.boost>0?-0.4:0)+sh*0.5,10+(st.boost>0?1.5:0)); cam.lookAt(st.x*0.75,1.2,-14);
    st.ready=st.dist<RANGE;
    for(const f of st.fx.slice()){ f.t-=dt; if(f.grow) f.m.scale.multiplyScalar(1+dt*8); if(f.t<=0){ scene.remove(f.m); st.fx.splice(st.fx.indexOf(f),1); } }
    if(st.hp<=0) end({win:false,why:'警車撞爛了，嫌犯揚長而去'});
    else if(st.time<=0&&st.capDelay<0) end({win:false,why:'追丟了，嫌犯鑽進巷子不見了'});
    else if(st.dist>75) end({win:false,why:'距離太遠，追丟了'});
  }

  // ---------- 射擊輪胎 ----------
  const RANGE=36, ray=new THREE.Raycaster(), UP=new THREE.Vector3(0,1,0);
  let vw=1, vh=1;
  function root(o){ while(o.parent&&o.parent!==scene) o=o.parent; return o; }
  function tracer(from,to){
    const d=to.clone().sub(from), len=d.length();
    const m=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,len,4),new THREE.MeshBasicMaterial({color:'#ffe680'}));
    m.position.copy(from).addScaledVector(d,0.5); m.quaternion.setFromUnitVectors(UP,d.normalize()); scene.add(m); st.fx.push({m,t:0.07});
    const f=new THREE.Mesh(new THREE.SphereGeometry(0.25,8,6),new THREE.MeshBasicMaterial({color:'#fff3b0'})); f.position.copy(from); scene.add(f); st.fx.push({m:f,t:0.05,grow:true});
  }
  function spark(p,c){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.3,8,6),new THREE.MeshBasicMaterial({color:c||'#ffb000'})); m.position.copy(p); scene.add(m); st.fx.push({m,t:0.18,grow:true}); }
  function fire(ndc){
    if(!st||st.over||st.phase!=='chase'||st.fireCd>0||st.capDelay>0) return;
    st.fireCd=0.26; st.shots++; G.audio.shot(); st.shake=Math.max(st.shake,0.06);
    const from=new THREE.Vector3(st.x-0.5,1.75,-2.3), tp=st.target.position.clone(); tp.y=0.45;
    let hit=false, point;
    if(ndc){
      ray.setFromCamera(ndc,cam);
      const hits=ray.intersectObjects([st.target,...st.objs.map(o=>o.m)],true);
      if(hits.length){ point=hits[0].point; const r=root(hits[0].object);
        if(r===st.target) hit=true;
        else { const o=st.objs.find(o=>o.m===r); if(o&&o.speed>0){ st.civHits++; pop('別打到民車！','bad'); spark(point,'#ff5050'); } } }
      else point=ray.ray.at(70,new THREE.Vector3());
      if(!hit&&!hits.length){ const p=tp.clone().project(cam); if(Math.hypot((p.x-ndc.x)*vw/2,(p.y-ndc.y)*vh/2)<46){ hit=true; point=tp.clone(); } }
    } else { // 自動瞄準（按鈕／空白鍵）
      const p=Math.min(0.92,Math.max(0.3,1.1-st.dist/RANGE*0.8)); hit=Math.random()<p;
      point=tp.clone().add(new THREE.Vector3((Math.random()-0.5)*(hit?0.8:3),Math.random()*(hit?0.5:1.5),0));
    }
    if(hit&&st.dist>RANGE){ hit=false; pop('射程外！再靠近一點','bad'); }
    tracer(from,point);
    if(hit){
      st.tire++; st.hits++; st.run++; st.bestRun=Math.max(st.bestRun,st.run); st.tSlow*=0.9; spark(point);
      if(st.tire>=st.need){ pop('輪胎爆了！','good'); st.capDelay=0.6; G.audio.crash(); }
      else pop(`命中輪胎！ ${st.tire}/${st.need}`,'good');
    } else st.run=0;
  }

  // ---------- 攔截壓制動畫 ----------
  function beginCapture(){
    st.phase='capture'; G.audio.crash(); G.audio.whistle();
    for(const o of st.objs) scene.remove(o.m); st.objs=[];
    const side=st.tLane===0?-1:1, curbX=side*3.9;
    st.cap={t:0,speed:st.pSpeed,side,
      tFrom:{x:st.tx,z:-st.dist,ry:st.target.rotation.y}, tTo:{x:curbX,z:-12},
      pFrom:{x:st.x,z:0,ry:st.player.rotation.y}, pTo:{x:curbX-side*2.3,z:-6.6}, stage:0};
  }
  function runLegs(p,on,speed=16){ const L=p.userData.legs; if(!L||!L.length) return; const s=on?Math.sin(st.anim*speed)*0.8:0; L[0].rotation.x=s; L[1].rotation.x=-s; }
  function capture(dt){
    const c=st.cap; c.t+=dt; const t=c.t;
    const k=Math.max(0,1-t/1.3); scroll(c.speed*k*k,dt);
    const e=ease(Math.min(1,t/1.3));
    st.target.position.set(lerp(c.tFrom.x,c.tTo.x,e),0,lerp(c.tFrom.z,c.tTo.z,e));
    st.target.rotation.y=Math.PI+c.side*(-0.5*Math.sin(e*Math.PI)+0.18*e);
    st.player.position.set(lerp(c.pFrom.x,c.pTo.x,e),0,lerp(c.pFrom.z,c.pTo.z,e));
    st.player.rotation.y=Math.PI-c.side*0.38*e;
    if(t<1.3&&Math.random()<0.5){ st.player.position.x+=(Math.random()-0.5)*0.05; }
    if(c.stage===0&&t>=1.35){ // 下車
      c.stage=1; G.audio.click();
      const tg=st.target; let hid=false;
      tg.traverse(o=>{ if(!hid&&o.userData&&o.userData.headG&&o!==tg){ o.visible=false; hid=true; } });
      c.sus=G.M.person({shirt:G.pick(['#e94f37','#f5b400','#7b4fbf','#2f9e6b']),head:hid?'hair':'hair'});
      c.sus.position.set(c.tTo.x-c.side*1.2,0,c.tTo.z+0.3); c.sus.rotation.y=Math.PI; scene.add(c.sus);
      c.cop=officer(); c.cop.position.set(c.pTo.x-c.side*1.3,0,c.pTo.z+0.6); c.cop.rotation.y=Math.PI; scene.add(c.cop);
      st.people.push(c.sus,c.cop);
    }
    if(c.stage===1){ // 嫌犯想跑、員警追
      const s=c.sus, p=c.cop;
      if(t>1.6){ s.position.z-=3.0*dt; s.position.x+=(c.tTo.x-c.side*2.0-s.position.x)*dt*2; runLegs(s,true,14); }
      const dx=s.position.x-p.position.x, dz=s.position.z-p.position.z, d=Math.hypot(dx,dz);
      if(t>1.5){ p.position.x+=dx/d*5.4*dt; p.position.z+=dz/d*5.4*dt; p.rotation.y=Math.atan2(dx,dz); runLegs(p,true,18); }
      if(t>1.6&&d<1.9||t>3.4){ c.stage=2; c.dt0=t; c.from={x:p.position.x,z:p.position.z}; G.audio.whoosh(); }
    }
    if(c.stage===2){ // 飛撲
      const s=c.sus, p=c.cop, q=Math.min(1,(t-c.dt0)/0.4);
      runLegs(p,false); runLegs(s,false);
      p.rotation.y=Math.PI; s.rotation.y=Math.PI;
      p.rotation.x=-Math.PI/2*q; p.position.set(lerp(c.from.x,s.position.x,q),Math.sin(q*Math.PI)*0.7+0.3*q,lerp(c.from.z,s.position.z+0.4,q));
      s.rotation.x=-Math.PI/2*Math.min(1,q*1.3); s.position.y=0.15*q;
      if(q>=1){ c.stage=3; c.pinT=t; st.shake=0.3; G.audio.crash(); }
    }
    if(c.stage===3){ // 壓制
      const s=c.sus, p=c.cop, q=Math.min(1,(t-c.pinT)/0.5);
      p.rotation.x=lerp(-Math.PI/2,-0.35,ease(q)); p.position.y=lerp(0.3,-0.42,ease(q)); p.position.z=s.position.z-0.75;
      s.userData.headG.rotation.y=Math.sin(st.anim*10)*0.4*(1-q*0.6);
      if(q>=1&&!c.pinned){ c.pinned=true; G.audio.cuff(); }
      if(t-c.pinT>2.4) end({win:true,clean:st.hp===3,sharp:st.civHits===0&&st.shots===st.hits});
    }
    st.shake=Math.max(0,st.shake-dt);
    const fx=c.sus?(c.sus.position.x+(c.cop?c.cop.position.x:0))/2:st.target.position.x;
    const fz=c.sus?(c.sus.position.z+c.cop.position.z)/2:st.target.position.z;
    const a=0.5+t*0.32*-c.side, r=c.stage>=2?6.5:9;
    const sh=st.shake>0?(Math.random()-0.5)*0.4:0;
    cam.fov+=(48-cam.fov)*Math.min(1,dt*3); cam.updateProjectionMatrix();
    cam.position.set(fx+Math.sin(a)*r+sh,c.stage>=2?2.8:3.8,fz+Math.cos(a)*r); cam.lookAt(fx,0.8,fz);
  }

  return {
    get scene(){return scene}, get cam(){return cam}, get state(){return st},
    start, update,
    left(){ if(st&&!st.over&&st.phase==='chase') st.lane=Math.max(0,st.lane-1); },
    right(){ if(st&&!st.over&&st.phase==='chase') st.lane=Math.min(2,st.lane+1); },
    siren(){ if(st&&!st.over&&st.phase==='chase'&&st.sirenCd<=0){ st.siren=3; st.sirenCd=7; G.audio.whistle(); pop('警笛！前車讓道','good'); return true;} return false; },
    boost(){ if(st&&!st.over&&st.phase==='chase'&&st.nitro>=0.5&&st.boost<=0){ st.nitro-=0.5; st.boost=1.6; G.audio.boost(); pop('全力衝刺！','good'); return true; } return false; },
    fire,
    screenPos(){ if(!st||st.phase!=='chase') return null; const p=st.target.position.clone(); p.y=0.9; p.project(cam); return {x:(p.x+1)/2*vw,y:(1-p.y)/2*vh,on:p.z<1,inRange:st.dist<RANGE}; },
    resize(w,h){ vw=w; vh=h; if(cam){ cam.aspect=w/h; cam.updateProjectionMatrix(); } },
  };
})();
