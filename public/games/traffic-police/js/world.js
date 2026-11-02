// 路口場景：中正路（東西向）× 民生路（南北向）
G.world = (function(){
  const {M,box,cyl,textTex}=G.M;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#a9cdea');
  scene.fog=new THREE.Fog('#bcd6ec',70,170);
  scene.add(new THREE.HemisphereLight('#e8f3ff','#7a7466',0.85));
  const sun=new THREE.DirectionalLight('#fff3dc',0.75); sun.position.set(40,80,25); scene.add(sun);

  const R=7.5, SIDE=12, LEN=110; const BLDS=[];
  const APPROACHES=[{axis:'x',dir:1},{axis:'x',dir:-1},{axis:'z',dir:1},{axis:'z',dir:-1}];
  const dvec=a=>a.axis==='x'?{x:a.dir,z:0}:{x:0,z:a.dir};
  const rvec=a=>{const d=dvec(a); return {x:-d.z,z:d.x};};
  const rsign=(axis,dir)=>axis==='x'?dir:-dir;

  function park(x,z,w,ry){
    const g=new THREE.Group(); box(w,0.06,9.5,'#7fae5a',0,0.03,-4.9,g); box(w,0.18,0.25,'#c9c4b8',0,0.09,-0.1,g);
    for(const lx of [-w/4,w/4]){ cyl(0.16,2.2,'#6b4a2b',lx,1.1,-4.5,g); const c=new THREE.Mesh(new THREE.SphereGeometry(1.4,8,6),M('#4f8f3a')); c.position.set(lx,2.9,-4.5); g.add(c); }
    box(1.6,0.12,0.5,'#8d6a43',0,0.5,-2.2,g); box(1.6,0.5,0.1,'#8d6a43',0,0.8,-2.45,g);
    g.position.set(x,0,z); g.rotation.y=ry; scene.add(g);
  }
  // 地面、道路
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(400,400),M('#b7b2a6')); ground.rotation.x=-Math.PI/2; scene.add(ground);
  const asphalt=M('#3d4047');
  const rEW=new THREE.Mesh(new THREE.PlaneGeometry(LEN*2,R*2),asphalt); rEW.rotation.x=-Math.PI/2; rEW.position.y=0.01; scene.add(rEW);
  const rNS=new THREE.Mesh(new THREE.PlaneGeometry(R*2,LEN*2),asphalt); rNS.rotation.x=-Math.PI/2; rNS.position.y=0.012; scene.add(rNS);
  // 騎樓地坪
  const arc=M('#9d968a');
  for(const s of [-1,1]){ box(LEN*2,0.02,3,arc,0,0.005,s*13.5,scene); box(3,0.02,LEN*2,arc,s*13.5,0.006,0,scene); }

  const paint=(w,d,c,x,z,y=0.025)=>{ const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),typeof c==='string'?new THREE.MeshBasicMaterial({color:c}):c); m.rotation.x=-Math.PI/2; m.position.set(x,y,z); scene.add(m); return m; };
  const WHITE='#eceae2', YEL='#f2c21b';
  // 路緣
  for(const s of [-1,1]) for(const t of [-1,1]){
    box(LEN-R,0.16,0.3,'#d6d2c8',t*(R+(LEN-R)/2),0.08,s*R,scene);
    box(0.3,0.16,LEN-R,'#d6d2c8',s*R,0.08,t*(R+(LEN-R)/2),scene);
    // 紅線（距路口 13~24m）
    box(11,0.17,0.32,'#d0262c',t*18.5,0.085,s*R,scene);
    box(0.32,0.17,11,'#d0262c',s*R,0.085,t*18.5,scene);
  }
  // 雙黃線、車道線
  for(const t of [-1,1]){
    for(const o of [-0.13,0.13]){ paint(LEN-12.5,0.12,YEL,t*(12.5+(LEN-12.5)/2),o); paint(0.12,LEN-12.5,YEL,o,t*(12.5+(LEN-12.5)/2)); }
    for(let a=14;a<LEN;a+=5) for(const o of [-3.75,3.75]){ paint(2.2,0.12,WHITE,t*a,o); paint(0.12,2.2,WHITE,o,t*a); }
  }
  // 停止線、斑馬線、機車優先字樣
  const mtTex=textTex('機車優先',{bg:'rgba(0,0,0,0)',fg:'#ecebe4',w:256,h:96});
  APPROACHES.forEach(a=>{
    const d=dvec(a), r=rvec(a);
    const cx=-d.x*12.5+r.x*3.75, cz=-d.z*12.5+r.z*3.75;
    paint(a.axis==='x'?0.4:7.5, a.axis==='x'?7.5:0.4, WHITE, cx, cz);
    const tm=new THREE.Mesh(new THREE.PlaneGeometry(3,1.1),new THREE.MeshBasicMaterial({map:mtTex,transparent:true}));
    tm.rotation.set(-Math.PI/2,0,0); const grp=new THREE.Group(); grp.add(tm); grp.rotation.y=Math.atan2(-d.x,-d.z);
    grp.position.set(-d.x*20+r.x*5.5,0.03,-d.z*20+r.z*5.5); scene.add(grp);
  });
  for(const t of [-1,1]) for(let i=-7;i<=7;i+=1.1){
    paint(0.55,3,WHITE,i,t*10,0.03);   // 南北臂（穿越民生路）
    paint(3,0.55,WHITE,t*10,i,0.03);   // 東西臂（穿越中正路）
  }
  // 停車格（中正路兩側）
  const SLOTS=[];
  for(const ax of [-1,1]) for(const s of [-1,1]){
    for(let c=28;c<=56;c+=6.5){
      const x=ax*c, z=s*6.1;
      paint(6.2,0.12,WHITE,x,s*4.75); paint(0.12,2.75,WHITE,x-3.1,z); paint(0.12,2.75,WHITE,x+3.1,z);
      SLOTS.push({x,z,axis:'x',dir:s,rotY:s>0?Math.PI/2:-Math.PI/2,doubleZ:s*4.15});
    }
  }
  const RED_SPOTS=[];
  for(const t of [-1,1]) for(const s of [-1,1]){
    RED_SPOTS.push({x:t*18.5,z:s*6.1,axis:'x',dir:s,rotY:s>0?Math.PI/2:-Math.PI/2});
    RED_SPOTS.push({x:s*6.1,z:t*18.5,axis:'z',dir:-s,rotY:s>0?Math.PI:0});
  }

  // 建築
  const ARMS=[{a:{x:0,z:-1},start:12},{a:{x:0,z:1},start:12},{a:{x:1,z:0},start:22.5},{a:{x:-1,z:0},start:22.5}];
  ARMS.forEach(arm=>{
    const ns=[{x:arm.a.z,z:arm.a.x},{x:-arm.a.z,z:-arm.a.x}];
    ns.forEach(n=>{
      let p=arm.start;
      while(p<LEN-5){
        const w=G.rand(6,10); const b=G.M.building(w);
        const c=p+w/2; b.position.set(n.x*SIDE+arm.a.x*c,0,n.z*SIDE+arm.a.z*c);
        b.rotation.y=Math.atan2(-n.x,-n.z);
        // 員警視野前方近處不放大樓，改成小公園
        const fx=n.x*(SIDE+5)+arm.a.x*c-11.5, fz=n.z*(SIDE+5)+arm.a.z*c-11.5;
        if(Math.hypot(fx,fz)<34&&(-fx-fz)>0){ park(b.position.x,b.position.z,w,b.rotation.y); p+=w+0.05; continue; }
        scene.add(b); BLDS.push({g:b,w,H:b.userData.H}); p+=w+0.05;
      }
      // 電線桿＋電線
      const poles=[];
      for(let q=16;q<LEN;q+=18){ const x=n.x*11.4+arm.a.x*q, z=n.z*11.4+arm.a.z*q; cyl(0.18,9,'#8f8b82',x,4.5,z,scene); box(1.6,0.12,0.12,'#6b6860',x,8.4,z,scene).rotation.y=Math.atan2(n.x,n.z); poles.push([x,z]); }
      const pts=[]; poles.forEach(([x,z])=>pts.push(new THREE.Vector3(x,8.3,z)));
      if(pts.length>1){ const lg=new THREE.BufferGeometry().setFromPoints(pts); const lm=new THREE.LineBasicMaterial({color:'#2a2a2a'}); for(const dy of [0,-0.4]){ const l=new THREE.Line(lg,lm); l.position.y=dy; scene.add(l);} }
    });
  });
  // 騎樓停滿機車、檳榔攤、變電箱
  G.M.parkedScooters(scene,30,-13.5,9);
  G.M.parkedScooters(scene,-60,13.5,10);
  G.M.parkedScooters(scene,-13.5,40,8,Math.PI/2);
  G.M.parkedScooters(scene,13.5,-64,7,Math.PI/2);
  G.M.betelStand(scene,-11.6,31,Math.PI/2);
  G.M.transformer(scene,11.2,26,-Math.PI/2);
  G.M.transformer(scene,-34,11.2,Math.PI);
  G.M.transformer(scene,44,-11.2,0);
  G.M.cone(scene,8.2,-36); G.M.cone(scene,8.2,-37.5);

  // 號誌
  const mk=(c,e)=>new THREE.MeshLambertMaterial({color:c,emissive:'#000'});
  const sigMats={EW:{r:mk('#400'),y:mk('#430'),g:mk('#041')},NS:{r:mk('#400'),y:mk('#430'),g:mk('#041')}};
  const pedMats={EW:{r:mk('#400'),g:mk('#041')},NS:{r:mk('#400'),g:mk('#041')}};
  const flashes={};
  APPROACHES.forEach(a=>{
    const d=dvec(a), r=rvec(a), key=a.axis==='x'?'EW':'NS';
    // 號誌裝在路口遠端（駕駛看出去的右前方），面向來車
    const px=d.x*8.4+r.x*8.4, pz=d.z*8.4+r.z*8.4, mine=px>0&&pz>0; // 玩家站的右下角不放桿子
    if(!mine){
      cyl(0.16,6.2,'#5a5f66',px,3.1,pz,scene);
      const arm=box(0.14,0.14,5.2,'#5a5f66',0,0,0,scene); arm.position.set(px-r.x*2.5,6.0,pz-r.z*2.5); arm.rotation.y=Math.atan2(r.x,r.z);
      const h=G.M.signalHead(sigMats[key]); h.scale.setScalar(1.25); h.position.set(d.x*8.4+r.x*3.2,5.1,d.z*8.4+r.z*3.2); h.rotation.y=Math.atan2(-d.x,-d.z); scene.add(h);
      const h2=G.M.signalHead(sigMats[key]); h2.scale.setScalar(0.8); h2.position.set(px-d.x*0.3,3.6,pz-d.z*0.3); h2.rotation.y=Math.atan2(-d.x,-d.z); scene.add(h2);
      const cam=box(0.5,0.35,0.7,'#e7e7e7',px-r.x*1.3,6.35,pz-r.z*1.3,scene); cam.rotation.y=Math.atan2(-d.x,-d.z);
    }
    const fl=new THREE.Mesh(new THREE.SphereGeometry(0.9,10,8),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.95}));
    fl.position.set(px-r.x*1.3,6.35,pz-r.z*1.3); fl.visible=false; scene.add(fl); flashes[a.axis+a.dir]={m:fl,t:0};
  });
  // 行人號誌：每條斑馬線兩端
  for(const t of [-1,1]) for(const e of [-1,1]){
    // 南北臂斑馬線（沿 x 走，EW 綠燈時可走）
    pedHead('EW',e*8.3,t*11.9,Math.atan2(-e,0));
    pedHead('NS',t*11.9,e*8.3,Math.atan2(0,-e));
  }
  function pedHead(key,x,z,ry){
    cyl(0.08,2.8,'#5a5f66',x,1.4,z,scene);
    const g=new THREE.Group(); box(0.45,0.8,0.25,'#2a2d33',0,0,0,g);
    const P=new THREE.PlaneGeometry(0.3,0.3);
    const rm=new THREE.Mesh(P,pedMats[key].r); rm.position.set(0,0.18,0.13); g.add(rm);
    const gm=new THREE.Mesh(P,pedMats[key].g); gm.position.set(0,-0.18,0.13); g.add(gm);
    g.position.set(x,2.6,z); g.rotation.y=ry; scene.add(g);
  }

  // 員警站的交通崗台（右下角）
  { const g=new THREE.Group(); box(1.6,5.4,1.6,'#2f5fa8',0,2.7,0,g); box(2.2,0.14,2.2,'#e8e8e8',0,5.47,0,g); for(let k=0;k<8;k++) box(0.5,0.08,0.5,'#cfd6e0',0.9,0.4+k*0.65,0.9-k*0.12,g);
    for(const [x,z,w,d] of [[0,1.05,2.2,0.06],[0,-1.05,2.2,0.06],[1.05,0,0.06,2.2],[-1.05,0,0.06,2.2]]) box(w,0.5,d,'#f5f5f5',x,5.8,z,g);
    const t=new THREE.Mesh(new THREE.PlaneGeometry(1.4,0.5),new THREE.MeshBasicMaterial({map:textTex('交通崗',{bg:'#1a3a8a',fg:'#fff',w:256,h:92})}));
    t.position.set(0,3.6,0.81); g.add(t); g.position.set(11.5,0,11.5); g.rotation.y=Math.atan2(-1,-1); scene.add(g); }

  // 靜態物件不再每幀重算矩陣
  scene.traverse(o=>{ o.updateMatrix(); o.matrixAutoUpdate=false; });

  // 號誌時相
  const CYCLE=[['EW','G',12],['EW','Y',2.5],['ALL','R',1.5],['NS','G',12],['NS','Y',2.5],['ALL','R',1.5]];
  const TOTAL=CYCLE.reduce((s,c)=>s+c[2],0);
  const sig={t:0, cur:{EW:'G',NS:'R'}, remain:{EW:12,NS:0}};
  function updateSignals(dt){
    sig.t=(sig.t+dt)%TOTAL;
    let acc=0, st={EW:'R',NS:'R'}, rem={EW:0,NS:0};
    for(const [k,s,d] of CYCLE){ if(sig.t<acc+d){ if(k!=='ALL'){ st[k]=s; if(s==='G') rem[k]=acc+d-sig.t; } break;} acc+=d; }
    sig.cur=st; sig.remain=rem;
    for(const k of ['EW','NS']){
      const m=sigMats[k], s=st[k];
      m.r.emissive.set(s==='R'?'#ff1a1a':'#000'); m.y.emissive.set(s==='Y'?'#ffb000':'#000'); m.g.emissive.set(s==='G'?'#19ff6a':'#000');
      const pg=st[k]==='G'; pedMats[k].g.emissive.set(pg?'#19ff6a':'#000'); pedMats[k].r.emissive.set(pg?'#000':'#ff1a1a');
    }
    for(const k in flashes){ const f=flashes[k]; if(f.t>0){ f.t-=dt; f.m.visible=f.t>0 && (f.t%0.16)>0.06; } }
  }
  return {
    scene, R, LEN, APPROACHES, BLDS, SLOTS, RED_SPOTS, dvec, rvec, rsign,
    update:updateSignals,
    light:axis=>sig.cur[axis==='x'?'EW':'NS'],
    pedGreen:(key,need=0)=>sig.cur[key]==='G' && sig.remain[key]>need,
    flash(axis,dir){ const f=flashes[axis+dir]; if(f){ f.t=0.5; G.audio.flash(); } },
    reset(){ sig.t=0; },
  };
})();
