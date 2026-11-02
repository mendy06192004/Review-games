// 用路人 NPC：生成、移動、號誌、違規判定、狀態機
// 狀態：MOVE → STOPPED(被攔) → MOVE(開完單離開) / TOW(拖吊) / GONE
G.npc = (function(){
  const W=G.world, R=W.R;
  const list=[]; let seq=1, tVeh=0, tPed=1, tPark=15, clock=0;
  const hitMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});
  const HIT=new THREE.BoxGeometry(1,1,1);

  function attachHit(n,w,h,d){ const m=new THREE.Mesh(HIT,hitMat); m.scale.set(w,h,d); m.position.y=h/2; m.userData.npc=n; n.group.add(m); n.hit=m; }
  function base(kind){ return {id:seq++,kind,state:'MOVE',actual:new Set(),speed:0,pos:new THREE.Vector3(),hx:0.4,hz:0.4,ticketed:false,dead:false,
    plate:G.plate(kind==='moto'?'moto':kind==='ped'?'ped':'car'), get otype(){return this.ptype?this.ptype:this.kind==='moto'?'moto':this.kind==='ped'?'ped':'car';}}; }

  // ---------- 車輛 ----------
  function laneLat(axis,dir,off){ return W.rsign(axis,dir)*off; }
  function placeVeh(v){
    const lt=v.lat+(v.zo||0);
    if(v.axis==='x') v.pos.set(v.dir*v.s,0,lt); else v.pos.set(lt,0,v.dir*v.s);
    v.group.position.copy(v.pos);
    v.hx=v.axis==='x'?v.len/2:v.wid/2; v.hz=v.axis==='x'?v.wid/2:v.len/2;
  }
  function motoTraits(){
    const t=new Set(); if(G.chance(0.6)) return t;
    const p=G.pick(['NOHELMET','NOHELMET','NOHELMET','OVERLOAD','OVERLOAD','CARGO','CARGO','SIDEWALK','REDLIGHT_M','STAND','PHONE_M','UMBRELLA','PET','ZIGZAG_M','ZIGZAG_M']); t.add(p);
    if(G.chance(0.3)){ const s=p==='NOHELMET'?G.pick(['OVERLOAD','SIDEWALK','REDLIGHT_M','CARGO','PHONE_M','UMBRELLA']):'NOHELMET'; t.add(s); }
    if(t.has('CARGO')&&t.has('OVERLOAD')) t.delete('OVERLOAD');
    if(t.has('STAND')&&t.has('OVERLOAD')) t.delete('OVERLOAD');
    return t;
  }
  function spawnVehicle(opt={}){
    const a=opt.a||G.pick(W.APPROACHES); const isMoto=opt.moto!=null?opt.moto:G.chance(0.58);
    const v=base(isMoto?'moto':'car'); v.axis=a.axis; v.dir=a.dir; v.s=opt.s0||-100; v.passed=false;
    let traits;
    if(isMoto){
      traits=opt.traits?new Set(opt.traits):motoTraits();
      const n=opt.heads?opt.heads.length:traits.has('OVERLOAD')?3:traits.has('CARGO')?1:(G.chance(0.35)?2:1);
      const heads=opt.heads?opt.heads.slice():Array(n).fill('helmet');
      const HATS=['hair','pot','hard','melon','plastic','conehat','cooker'];
      if(traits.has('NOHELMET')&&!opt.heads){ const bad=G.ri(0,n-1); heads[bad]=G.pick(HATS); if(n>1&&G.chance(0.3)) heads[(bad+1)%n]=G.pick(HATS); }
      const CARGOS={fridge:'載冰箱',scooter:'載機車',ladder:'竹竿橫放',gas:'瓦斯桶疊高',sofa:'載沙發',bear:'載巨大玩偶'};
      const cargo=traits.has('CARGO')?G.pick(Object.keys(CARGOS)):G.pick(['none','none','box','bag']);
      v.group=G.M.moto({riders:heads,cargo,stand:traits.has('STAND'),phone:traits.has('PHONE_M'),umbrella:traits.has('UMBRELLA'),pet:traits.has('PET')});
      v.len=1.9; v.wid=0.8; v.max=G.rand(6.5,8.5);
      v.riders=n; v.label=n===1?'機車':`機車（${n} 人）`; if(CARGOS[cargo]) v.label=`機車（${CARGOS[cargo]}）`;
      if(traits.has('PET')) v.max=5.5;
      if(traits.has('SIDEWALK')){ v.baseLat=laneLat(a.axis,a.dir,9.8); v.altLat=laneLat(a.axis,a.dir,5.5); v.sidewalk=true; v.max=5; v.label+='・人行道'; }
      else { v.baseLat=laneLat(a.axis,a.dir,5.5); v.altLat=laneLat(a.axis,a.dir,2.0); }
      v.runner=traits.has('REDLIGHT_M');
      v.zig=traits.has('ZIGZAG_M');
      if(!opt.a&&!traits.has('SIDEWALK')&&!v.runner&&!v.zig&&G.chance(0.22)){ v.turn=true; v.label+='・右轉'; }
      attachHit(v,1.6,2.6,2.6);
    } else {
      traits=new Set();
      if(G.chance(0.42)){ v.turn=true; const r=Math.random(); if(r<0.4) v.runner=true; else if(r<0.85) v.rude=true; }
      else if(G.chance(0.2)) traits.add('REDLIGHT_C');
      else if(G.chance(0.14)){ traits.add('ZIGZAG_C'); v.zig=true; }
      const kind=G.chance(0.25)?'taxi':G.chance(0.18)?'truck':'sedan';
      v.group=G.M.car(kind); v.len=v.group.userData.len; v.wid=1.9; v.max=G.rand(8.5,10.5);
      v.label={taxi:'計程車',truck:'發財車',sedan:'自用小客車'}[kind];
      if(v.turn){ v.baseLat=laneLat(a.axis,a.dir,5.5); v.altLat=laneLat(a.axis,a.dir,2.0); v.max=G.rand(7.5,9); v.label+='（右轉）'; }
      else { v.baseLat=laneLat(a.axis,a.dir,2.0); v.altLat=laneLat(a.axis,a.dir,5.5); }
      if(!v.turn) v.runner=traits.has('REDLIGHT_C');
      attachHit(v,2.8,2.8,v.len+0.8);
    }
    v.lat=v.targetLat=v.baseLat;
    // 入口淨空檢查
    for(const o of list) if(o.axis===v.axis&&o.dir===v.dir&&o.kind!=='parked'&&o.kind!=='ped'&&Math.abs(o.lat-v.lat)<1.5&&Math.abs(o.s-v.s)<v.len+5) return null;
    for(const k of traits) if(k!=='REDLIGHT_M'&&k!=='REDLIGHT_C') v.actual.add(k);
    v.speed=v.max; v.isVeh=true;
    const d=W.dvec(a); v.group.rotation.y=v.yaw0=Math.atan2(d.x,d.z);
    if(opt.hold!=null){ v.hold=opt.hold; v.max=Math.min(v.max,6); v.tut=true; }
    placeVeh(v); W.scene.add(v.group); list.push(v); return v;
  }
  function isBlocker(o,v){
    if(o.kind==='parked') return true;
    if(v&&v.sidewalk&&o.kind==='ped') return true;
    if(o.state==='STOPPED'||o.state==='CRASH') return true;
    if(o.kind==='ped') return o.onRoad;
    return false;
  }
  function scan(v,lat,minF=0.01){
    let best={gap:999,obj:null,along:0,ext:0};
    const inBox=Math.abs(v.pos.x)<R+1.5&&Math.abs(v.pos.z)<R+1.5;
    for(const o of list){
      if(o===v||o.dead||o.state==='TOW') continue;
      if(v.rudeGo&&o.kind==='ped') continue;
      if(o.isVeh&&o.axis!==v.axis){ if(inBox) continue; if(!(Math.abs(o.pos.x)<R+1&&Math.abs(o.pos.z)<R+1)) continue; }
      const along=v.axis==='x'?o.pos.x*v.dir:o.pos.z*v.dir;
      const olat=v.axis==='x'?o.pos.z:o.pos.x;
      const aE=v.axis==='x'?o.hx:o.hz, lE=v.axis==='x'?o.hz:o.hx;
      const f=along-v.s; if(f<minF) continue;
      if(Math.abs(olat-lat)>v.wid/2+lE+0.12) continue;
      const gap=f-v.len/2-aE;
      if(gap<best.gap) best={gap,obj:o,along,ext:aE};
    }
    return best;
  }
  // 出口斑馬線上有沒有行人（右轉要讓）
  function pedOnExit(v){
    const d=W.dvec(v), r={x:-d.z,z:d.x};
    for(const o of list){ if(o.kind!=='ped'||o.dead||!o.onRoad) continue;
      const al=o.pos.x*r.x+o.pos.z*r.z, lt=Math.abs(o.pos.x*d.x+o.pos.z*d.z);
      if(al>8&&al<12&&lt<7.6) return true; }
    return false;
  }
  function startTurn(v){
    const d=W.dvec(v), r={x:-d.z,z:d.x}, L=Math.abs(v.lat), rad=7.5-L;
    v.tw={d,r,L,rad,cx:-d.x*7.5+r.x*7.5,cz:-d.z*7.5+r.z*7.5,th:0};
    v.turning=true;
    if(v.rude&&pedOnExit(v)){ v.actual.add('NOYIELD'); v.rudeGo=true; say(v,'NOYIELD'); }
  }
  function updateTurn(v,dt){
    const t=v.tw; v.speed=Math.min(v.speed+4*dt,6);
    if(v.rude&&!v.actual.has('NOYIELD')&&pedOnExit(v)){ v.actual.add('NOYIELD'); v.rudeGo=true; say(v,'NOYIELD'); }
    t.th=Math.min(Math.PI/2,t.th+v.speed*dt/Math.max(1.5,t.rad));
    const c=Math.cos(t.th), s=Math.sin(t.th);
    v.pos.set(t.cx-t.r.x*t.rad*c+t.d.x*t.rad*s,0,t.cz-t.r.z*t.rad*c+t.d.z*t.rad*s);
    v.group.position.copy(v.pos);
    const hx=t.r.x*s+t.d.x*c, hz=t.r.z*s+t.d.z*c; v.group.rotation.y=Math.atan2(hx,hz);
    v.hx=v.hz=v.len/2;
    if(t.th>=Math.PI/2){ // 進入新道路
      v.turning=false; v.turn=false; v.turned=true;
      v.axis=Math.abs(t.r.x)>0.5?'x':'z'; v.dir=v.axis==='x'?Math.sign(t.r.x):Math.sign(t.r.z);
      v.s=7.5; v.lat=v.targetLat=v.baseLat=laneLat(v.axis,v.dir,t.L);
      v.altLat=laneLat(v.axis,v.dir,t.L>4?2.0:5.5); v.passed=true; v.blink=false;
      if(v.group.userData.hazardR) v.group.userData.hazardR.emissive.set('#000');
      placeVeh(v);
    }
  }
  function updateVeh(v,dt){
    if(v.state==='CRASH') return;
    if(v.state==='STOPPED'){ if(v.turning){ v.speed=0; return; } v.speed=Math.max(0,v.speed-18*dt); v.s+=v.speed*dt; placeVeh(v); return; }
    if(v.turn&&v.group.userData.hazardR&&v.s>-45) v.group.userData.hazardR.emissive.set((clock%0.7)<0.35?'#ffa000':'#000');
    if(v.turning){ updateTurn(v,dt); return; }
    if(v.rudeGo&&v.s>16) v.rudeGo=false;
    if(v.s>-32&&v.s<-20&&!v.said0){ v.said0=1; const st=[...v.actual]; if(st.length) say(v,G.pick(st),0.6); else if(Math.random()<0.1) ev.say(v,G.pick(G.SMALLTALK)); }
    if(v.group.userData.dog){ const L=v.group.userData.dog.userData.legs, s=Math.sin(clock*14+v.id)*0.6; L[0].rotation.x=L[3].rotation.x=s; L[1].rotation.x=L[2].rotation.x=-s; }
    // 閃避（併排、被攔下的車、走在車道的人）
    if(v.altLat!==undefined){
      const sb=scan(v,v.baseLat);
      if(v.targetLat===v.baseLat){
        if(sb.obj&&isBlocker(sb.obj,v)&&sb.gap<14){ const sa=scan(v,v.altLat,-5); if(sa.gap>sb.gap+5){ v.targetLat=v.altLat; v.swerveTo=sb.along+sb.ext+v.len/2+2; } }
      } else if(v.s>v.swerveTo&&(!sb.obj||sb.gap>4||!isBlocker(sb.obj,v))){
        const back=scan(v,v.baseLat,-3); if(back.gap>1.5) v.targetLat=v.baseLat;
      }
    }
    const dl=v.targetLat-v.lat; v.lat+=Math.sign(dl)*Math.min(Math.abs(dl),3.2*dt);
    let gap=scan(v,v.lat).gap;
    const front=v.s+v.len/2, sig=W.light(v.axis);
    if(!v.passed){
      if(front>=-12.5){ v.passed=true;
        if(v.runner&&sig==='R'){ const k=v.turn?'RIGHT_RED':v.kind==='moto'?'REDLIGHT_M':'REDLIGHT_C'; v.actual.add(k); W.flash(v.axis,v.dir); say(v,k,0.85); } }
      else if(sig!=='G'&&!v.runner){ const sg=-12.5-front; if(!(sig==='Y'&&sg<5)) gap=Math.min(gap,sg-0.2); }
    }
    if(v.turn){
      if(v.s>=-7.5){
        if(Math.abs(Math.abs(v.lat)-Math.abs(v.baseLat))<0.4){ startTurn(v); return; }
        v.turn=false; if(v.group.userData.hazardR) v.group.userData.hazardR.emissive.set('#000');
      } else {
        const lim=Math.max(5,(-7.5-v.s)*0.9+5); // 轉彎前減速
        if(v.passed&&!v.rude&&!v.runner&&pedOnExit(v)) gap=Math.min(gap,-7.5-v.s-0.3); // 守法車停下讓行人
        gap=Math.min(gap,lim/1.7+0.4);
      }
    }
    let want=gap<0.4?0:Math.min(v.max,(gap-0.4)*1.7);
    if(v.hold!=null) want=Math.min(want,Math.max(0,(v.hold-v.s)*1.6));
    v.speed = want<v.speed ? Math.max(want,v.speed-20*dt) : Math.min(want,v.speed+5*dt);
    v.s+=v.speed*dt;
    if(v.zig){ const amp=Math.min(1,v.speed/4)*1.25, ph=clock*2.3+v.id; v.zo=Math.sin(ph)*amp; v.group.rotation.y=v.yaw0+Math.cos(ph)*0.32*amp*W.rsign(v.axis,v.dir)*(v.axis==='x'?-1:1); }
    placeVeh(v);
    if(v.kind==='moto') v.group.rotation.z=Math.sin(clock*2+v.id)*0.03;
    if(!v.crashChk&&v.passed&&v.s>13&&v.s<22&&!v.ticketed){ v.crashChk=true; if([...v.actual].some(k=>G.RISKY.includes(k))&&api.crashOK()&&Math.random()<0.45){ crash(v); return; } }
    v.stall=v.speed<0.1?(v.stall||0)+dt:0;
    if(v.s>100||(v.stall>12&&Math.abs(v.s)>45)) remove(v);
  }

  // ---------- 停放車輛 ----------
  function spawnParked(type,fixed){
    let spot, lat;
    if(fixed){ spot=fixed; }
    else if(type==='REDLINE'){ spot=G.pick(W.RED_SPOTS); }
    else { const free=W.SLOTS.filter(s=>!list.some(o=>o.kind==='parked'&&o.slot===s&&!o.dbl)); if(!free.length) return; spot=G.pick(free); }
    if(type==='DOUBLE'&&!fixed){ // 必須旁邊有車
      const occ=W.SLOTS.filter(s=>list.some(o=>o.kind==='parked'&&o.slot===s&&!o.dbl)&&!list.some(o=>o.dbl&&o.slot===s));
      if(!occ.length) return; spot=G.pick(occ);
    }
    if(list.some(o=>o.kind==='parked'&&o.slot===spot&&(type==='DOUBLE'?o.dbl:!o.dbl))) return;
    const p=base('parked'); p.slot=spot; p.dbl=type==='DOUBLE'; p.axis=spot.axis; p.dir=spot.dir;
    const kind=G.chance(0.2)?'taxi':G.chance(0.2)?'truck':'sedan';
    p.group=G.M.car(kind); p.len=p.group.userData.len; p.wid=1.9;
    p.label=({taxi:'計程車',truck:'發財車',sedan:'自用小客車'})[kind]+'（停放中）';
    if(type==='REDLINE'||type==='DOUBLE') p.actual.add(type);
    p.hazard=type==='DOUBLE'||(type==='OK'&&G.chance(0.18));
    const z=p.dbl?spot.doubleZ:spot.z;
    if(spot.axis==='x') p.pos.set(spot.x,0,z); else p.pos.set(spot.x,0,spot.z);
    p.group.position.copy(p.pos); p.group.rotation.y=spot.rotY;
    p.hx=spot.axis==='x'?p.len/2:0.95; p.hz=spot.axis==='x'?0.95:p.len/2;
    attachHit(p,2.8,2.8,p.len+0.8);
    W.scene.add(p.group); list.push(p); return p;
  }
  function spawnWalkPark(){ // 汽車停在人行道上（半邊壓上路緣）
    const sx=G.chance(0.5)?1:-1, sz=G.chance(0.5)?1:-1, x=sx*G.rand(27,56), z=sz*8.55;
    if(list.some(o=>o.kind==='parked'&&Math.abs(o.pos.x-x)<6&&Math.abs(o.pos.z-z)<1.5)) return;
    const p=base('parked'); p.walk=true; p.actual.add('WALKPARK');
    const kind=G.pick(['sedan','sedan','taxi','truck']); p.group=G.M.car(kind); p.len=p.group.userData.len; p.wid=1.9;
    p.label=({taxi:'計程車',truck:'發財車',sedan:'自用小客車'})[kind]+'（停放中）';
    p.pos.set(x,0,z); p.group.position.set(x,0.16,z); p.group.rotation.set(0,Math.PI/2,sz*0.04);
    p.hx=p.len/2; p.hz=0.95; attachHit(p,2.8,2.8,p.len+0.8); W.scene.add(p.group); list.push(p);
  }
  function spawnCrossPark(){ // 機車停在斑馬線上
    const t=G.chance(0.5)?1:-1, s=G.chance(0.5)?1:-1, ns=G.chance(0.5);
    const x=ns?s*7.05:t*10+G.rand(-1,1), z=ns?t*10+G.rand(-1,1):s*7.05;
    if(list.some(o=>o.kind==='parked'&&o.ptype==='moto'&&Math.abs(o.pos.x-x)<3&&Math.abs(o.pos.z-z)<3)) return;
    const p=base('parked'); p.ptype='moto'; p.actual.add('CROSSPARK');
    p.group=G.M.moto({riders:[]}); p.len=1.9; p.wid=0.8; p.label='機車（停在斑馬線）'; p.plate=G.plate('moto');
    p.pos.set(x,0,z); p.group.position.copy(p.pos); p.group.rotation.y=ns?0:Math.PI/2;
    p.hx=ns?0.4:0.95; p.hz=ns?0.95:0.4; attachHit(p,1.6,2,2.6); W.scene.add(p.group); list.push(p);
  }
  function parkTick(){
    const parked=list.filter(o=>o.kind==='parked'&&o.state!=='TOW');
    if(parked.length<Math.round(7+4*api.density)){
      const r=Math.random();
      const cnt=k=>list.filter(o=>o.actual.has(k)).length;
      if(r<0.42) spawnParked('OK'); else if(r<0.6) spawnParked('REDLINE'); else if(r<0.75) spawnParked('DOUBLE');
      else if(r<0.88){ if(cnt('WALKPARK')<2) spawnWalkPark(); } else if(cnt('CROSSPARK')<2) spawnCrossPark();
    }
    const leave=parked.filter(o=>!o.dbl&&!o.actual.size&&o.state==='MOVE'&&!list.some(d=>d.dbl&&d.slot===o.slot));
    if(leave.length>4&&G.chance(0.6)) remove(G.pick(leave));
  }

  // ---------- 行人 ----------
  function rot(p,k){ let {x,z}=p; for(let i=0;i<k;i++){ const t=x; x=-z; z=t; } return Object.assign({},p,{x,z}); }
  function spawnPed(){
    if(list.filter(o=>o.kind==='ped').length>=Math.round(4+11*api.density)) return;
    const r=Math.random(); let type='OK', route;
    if(r<0.14) type='JAYWALK'; else if(r<0.25) type='ROADWALK'; else if(r<0.4) type='PEDRED';
    const k=(type==='JAYWALK'||type==='ROADWALK')?G.pick([0,2]):G.ri(0,3), key=k%2?'NS':'EW', s0=G.chance(0.5)?1:-1;
    const far=-G.rand(45,80), far2=-G.rand(45,80);
    if(type==='JAYWALK'){ const zc=-G.rand(28,55);
      route=[{x:s0*9.8,z:far},{x:s0*9.8,z:zc,mark:'JAYWALK',road:true},{x:-s0*9.8,z:zc+G.rand(-3,3)},{x:-s0*9.8,z:far2}];
    } else if(type==='ROADWALK'){
      route=[{x:s0*9.8,z:far},{x:s0*5.6,z:far+3,mark:'ROADWALK',road:true},{x:s0*5.6,z:-26,road:true},{x:s0*9.8,z:-23},{x:s0*14,z:-23}];
    } else {
      route=[{x:s0*9.8,z:far},{x:s0*9.8,z:-10,wait:key},{x:-s0*9.8,z:-10},{x:-s0*9.8,z:far2}];
    }
    route=route.map(p=>rot(p,k));
    const p=base('ped'); p.route=route; p.idx=1; p.pedRed=type==='PEDRED';
    p.max=type==='ROADWALK'?1.1:type==='JAYWALK'?2.6:G.rand(1.9,2.4);
    p.group=G.M.person({phone:type==='ROADWALK'||G.chance(0.18)});
    p.label=type==='ROADWALK'||p.group.userData.headG.rotation.x>0?'行人（滑手機）':'行人';
    p.pos.set(route[0].x,0,route[0].z); p.group.position.copy(p.pos);
    p.hx=p.hz=0.35; attachHit(p,1.3,2.2,1.3);
    W.scene.add(p.group); list.push(p);
  }
  function updatePed(p,dt){
    const legs=p.group.userData.legs;
    if(p.state==='STOPPED'||p.waiting){
      legs.forEach(l=>l.rotation.x*=0.8);
      if(p.waiting&&W.pedGreen(p.waiting,4)) p.waiting=null;
      return;
    }
    const prev=p.route[p.idx-1], t=p.route[p.idx];
    const dx=t.x-p.pos.x, dz=t.z-p.pos.z, d=Math.hypot(dx,dz);
    p.onRoad=!!prev.road||(Math.abs(p.pos.x)<7.5&&Math.abs(p.pos.z)<40)||(Math.abs(p.pos.z)<7.5&&Math.abs(p.pos.x)<40);
    if(p.onRoad){ for(const o of list) if(o.isVeh&&o.speed>0.5&&Math.abs(o.pos.x-p.pos.x)<2.3&&Math.abs(o.pos.z-p.pos.z)<2.3){ legs.forEach(l=>l.rotation.x*=0.8); p.startle=0.6; if(!p.scared){ p.scared=1; ev.say(p,G.pick(['嚇死人了！','欸欸欸！','看路啦！'])); } break; } }
    if(p.startle>0){ p.startle-=dt; return; }
    const step=p.max*dt;
    if(d<=step){
      p.pos.set(t.x,0,t.z); p.idx++;
      if(p.idx>=p.route.length){ remove(p); return; }
      if(t.mark){ p.actual.add(t.mark); say(p,t.mark,0.7); }
      if(t.wait){
        if(p.pedRed){ if(!W.pedGreen(t.wait,0)){ p.actual.add('PEDRED'); say(p,'PEDRED',0.7); } }
        else if(!W.pedGreen(t.wait,4)) p.waiting=t.wait;
      }
    } else { p.pos.x+=dx/d*step; p.pos.z+=dz/d*step; p.group.rotation.y=Math.atan2(dx,dz); }
    p.group.position.copy(p.pos);
    const sw=Math.sin(clock*p.max*4.2+p.id)*0.55; legs[0].rotation.x=sw; legs[1].rotation.x=-sw;
  }

  const ev={say(){},crash(){}};
  const accs=[];
  function crash(v){
    v.state='CRASH'; v.speed=0;
    v.group.rotation.y+=G.rand(0.5,1.1)*(Math.random()<0.5?-1:1);
    if(v.kind==='moto'){ v.group.rotation.z=1.35; v.group.position.y=0.3; }
    const g=new THREE.Group();
    const vm=G.M.moto({riders:[]}); vm.rotation.set(0,G.rand(0,6),1.4); vm.position.set(G.rand(1.8,2.6),0.3,G.rand(-1.2,1.2)); g.add(vm);
    const vp=G.M.person({seated:true}); vp.position.set(3.4,-0.86,1.2); vp.rotation.y=G.rand(0,6); g.add(vp);
    for(let i=0;i<6;i++){ const d=G.M.box(G.rand(0.1,0.3),0.05,G.rand(0.1,0.3),G.pick(['#c62828','#333','#ddd','#f5b400']),G.rand(-1.5,3.5),0.03,G.rand(-2,2),g); d.rotation.y=Math.random()*3; }
    const smoke=[]; for(let i=0;i<4;i++){ const m=new THREE.Mesh(new THREE.SphereGeometry(0.5,8,6),new THREE.MeshBasicMaterial({color:'#8a8a8a',transparent:true,opacity:0.5})); m.userData.ph=i/4; g.add(m); smoke.push(m); }
    const mk=new THREE.Mesh(new THREE.ConeGeometry(0.6,1.1,3),new THREE.MeshBasicMaterial({color:'#ff2a2a'})); mk.rotation.x=Math.PI; mk.position.set(1.2,4.6,0); g.add(mk);
    const hit=new THREE.Mesh(new THREE.BoxGeometry(7,3.5,7),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false})); hit.position.set(1.2,1.6,0); g.add(hit);
    g.position.set(v.pos.x,0,v.pos.z); W.scene.add(g);
    const acc={v,g,smoke,mk,hit,pos:new THREE.Vector3(v.pos.x+1.2,1,v.pos.z)}; accs.push(acc); ev.crash(acc);
  }
  function updAccs(dt){ for(const a of accs){ a.mk.position.y=4.6+Math.sin(clock*5)*0.3; a.mk.rotation.y+=dt*3;
    for(const m of a.smoke){ const t=(clock*0.5+m.userData.ph)%1; m.position.set(Math.sin(t*6)*0.3,0.8+t*3.5,0.2); m.scale.setScalar(0.5+t*1.6); m.material.opacity=0.55*(1-t); } } }
  function say(o,key,p=1){ if(o.said&&o.said[key]) return; (o.said=o.said||{})[key]=1; if(Math.random()<p){ const L=G.SHOUT[key]; if(L) ev.say(o,G.pick(L)); } }
  function remove(o){ o.dead=true; W.scene.remove(o.group); const i=list.indexOf(o); if(i>=0) list.splice(i,1); }

  const api={
    density:1, list, ev, accs, crashOK:()=>false,
    clearCrash(a){ remove(a.v); W.scene.remove(a.g); const i=accs.indexOf(a); if(i>=0) accs.splice(i,1); },
    update(dt){
      clock+=dt;
      tVeh-=dt; if(tVeh<=0){ tVeh=G.rand(0.6,1.25)/api.density; if(list.filter(o=>o.isVeh).length<Math.round(6+20*api.density)) spawnVehicle(); }
      tPed-=dt; if(tPed<=0){ tPed=G.rand(1.1,2.2)/api.density; spawnPed(); }
      tPark-=dt; if(tPark<=0){ tPark=G.rand(9,16); parkTick(); }
      updAccs(dt);
      for(const o of list.slice()){
        if(o.dead) continue;
        if(o.isVeh) updateVeh(o,dt);
        else if(o.kind==='ped') updatePed(o,dt);
        else if(o.kind==='parked'&&o.hazard){ const on=(clock%0.8)<0.4; o.group.userData.hazard.emissive.set(on?'#ffa000':'#000'); o.group.userData.hazardR.emissive.set(on?'#ffa000':'#000'); }
        if(o.state==='TOW'){ o.towT-=dt; o.group.position.y+=dt*0.6; o.group.rotation.x=-0.15; if(o.towT<=0) remove(o); }
      }
    },
    init(){
      while(list.length) remove(list[0]); while(accs.length){ W.scene.remove(accs[0].g); accs.shift(); }
      for(let i=0;i<6;i++) spawnParked('OK');
      spawnParked('REDLINE'); spawnParked('DOUBLE'); spawnWalkPark(); spawnCrossPark();
      // 預熱：讓路上先有車流
      for(let i=0;i<300;i++){ W.update(1/30); api.update(1/30); }
    },
    spawnTut(kind){
      if(kind==='helmetless') return spawnVehicle({a:{axis:'z',dir:1},moto:true,traits:['NOHELMET'],heads:['pot'],s0:-48,hold:-15.5});
      if(kind==='lawful') return spawnVehicle({a:{axis:'z',dir:1},moto:true,traits:[],heads:['helmet'],s0:-48,hold:-15.5});
      if(kind==='redline'){ const sp=W.RED_SPOTS.find(s=>s.x<0&&s.z<0&&s.axis==='z'); for(const o of list.slice()) if(o.kind==='parked'&&Math.abs(o.pos.x-sp.x)<3&&Math.abs(o.pos.z-sp.z)<4) remove(o); const p=spawnParked('REDLINE',sp); if(p) p.tut=true; return p; }
    },
    halt(o){ o.hold=null; o.state='STOPPED'; if(o.kind==='ped') o.waiting=null; },
    release(o){ o.hold=null; o.state='MOVE'; o.ticketed=true; },
    tow(o){ o.state='TOW'; o.towT=1.6; o.ticketed=true; },
    remove,
  };
  return api;
})();
