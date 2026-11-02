// 低多邊形模型工廠：所有載具面向 +z
G.M = (function(){
  const matCache={};
  const M=(c,opt)=>{ const k=c+(opt?JSON.stringify(opt):''); return matCache[k]||(matCache[k]=new THREE.MeshLambertMaterial(Object.assign({color:c},opt||{}))); };
  const BOX=new THREE.BoxGeometry(1,1,1), CYL=new THREE.CylinderGeometry(1,1,1,12), SPH=new THREE.SphereGeometry(1,12,8);
  const HEMI=new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2);
  function box(w,h,d,c,x=0,y=0,z=0,p){ const m=new THREE.Mesh(BOX,typeof c==='string'||typeof c==='number'?M(c):c); m.scale.set(w,h,d); m.position.set(x,y,z); if(p)p.add(m); return m; }
  function cyl(r,h,c,x,y,z,p,rx=0,rz=0){ const m=new THREE.Mesh(CYL,typeof c==='object'?c:M(c)); m.scale.set(r,h,r); m.position.set(x,y,z); m.rotation.set(rx,0,rz); if(p)p.add(m); return m; }
  function sph(r,c,x,y,z,p){ const m=new THREE.Mesh(SPH,typeof c==='object'?c:M(c)); m.scale.set(r,r,r); m.position.set(x,y,z); if(p)p.add(m); return m; }

  function textTex(text,{bg='#c8102e',fg='#fff',w=256,h=96,vertical=false,size=0,font='900'}={}){
    const cv=document.createElement('canvas'); cv.width=w; cv.height=h; const c=cv.getContext('2d');
    c.fillStyle=bg; c.fillRect(0,0,w,h); c.fillStyle=fg; c.textAlign='center'; c.textBaseline='middle';
    const fam='"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    if(vertical){ const n=text.length, s=size||Math.min(w*0.72,h/n*0.86); c.font=`${font} ${s}px ${fam}`;
      [...text].forEach((ch,i)=>c.fillText(ch,w/2,h/n*(i+0.5)));
    } else { const s=size||Math.min(h*0.66,w/text.length*0.9); c.font=`${font} ${s}px ${fam}`; c.fillText(text,w/2,h/2+2); }
    const t=new THREE.CanvasTexture(cv); t.anisotropy=4; return t;
  }

  const SKIN=['#f1c9a5','#e0ac83','#c98e64','#f5d2b8'];
  const SHIRTS=['#e94f37','#3d7dd8','#f2f2f2','#2f9e6b','#f5b400','#7b4fbf','#444b5a','#ff7aa8','#1f3a5f'];
  const PANTS=['#2b3445','#3c4f7a','#5a4632','#222','#6d7280'];

  // 人：站立 or 坐姿
  function person({shirt=G.pick(SHIRTS),pants=G.pick(PANTS),skin=G.pick(SKIN),seated=false,scale=1,head='hair',phone=false}={}){
    const g=new THREE.Group(); const legs=[];
    if(!seated){
      for(const sx of [-0.12,0.12]){ const pv=new THREE.Group(); pv.position.set(sx,0.85,0); box(0.18,0.85,0.2,pants,0,-0.42,0,pv); box(0.2,0.1,0.3,'#222',0,-0.85,0.05,pv); g.add(pv); legs.push(pv); }
      box(0.48,0.6,0.28,shirt,0,1.15,0,g);
      for(const sx of [-0.31,0.31]){ const a=box(0.13,0.55,0.15,shirt,sx,1.12,phone?0.12:0,g); if(phone) a.rotation.x=-0.9; }
    } else {
      box(0.2,0.18,0.55,pants,-0.12,0.95,0.15,g); box(0.2,0.18,0.55,pants,0.12,0.95,0.15,g);
      box(0.18,0.5,0.18,pants,-0.13,0.65,0.42,g); box(0.18,0.5,0.18,pants,0.13,0.65,0.42,g);
      box(0.48,0.6,0.28,shirt,0,1.32,-0.05,g);
      const a1=box(0.13,0.5,0.15,shirt,-0.3,1.3,0.18,g), a2=box(0.13,0.5,0.15,shirt,0.3,1.3,0.18,g); a1.rotation.x=a2.rotation.x=-1.1;
    }
    const hy=seated?1.84:1.66; const headG=new THREE.Group(); headG.position.y=hy; g.add(headG);
    sph(0.19,skin,0,0,0,headG);
    setHead(headG,head);
    if(phone){ headG.rotation.x=0.45; box(0.12,0.2,0.03,'#111',0,1.42,0.38,g); const glow=box(0.1,0.17,0.01,M('#9fe7ff',{emissive:'#4fc3ff'}),0,1.42,0.36,g); glow.rotation.x=0.3; }
    g.scale.setScalar(scale);
    g.userData={legs,headG};
    return g;
  }
  function setHead(headG,type){
    while(headG.children.length>1) headG.remove(headG.children[1]);
    if(type==='hair'){ const h=new THREE.Mesh(HEMI,M(G.pick(['#1b1b1b','#3a2a1a','#222','#5b3b22']))); h.scale.set(0.205,0.17,0.205); h.position.y=0.02; headG.add(h); }
    else if(type==='helmet'){ const c=G.pick(['#e53935','#fafafa','#1e88e5','#ff7aa8','#8e24aa','#43a047','#ff8f00']);
      const h=new THREE.Mesh(HEMI,M(c,{emissive:c,emissiveIntensity:0.25})); h.scale.set(0.3,0.34,0.3); h.position.y=-0.06; headG.add(h);
      box(0.36,0.14,0.05,M('#1b2a3a',{emissive:'#2a4b6e'}),0,-0.02,0.27,headG);
      box(0.4,0.06,0.04,'#222',0,-0.05,0.24,headG); box(0.03,0.2,0.03,'#222',-0.2,-0.2,0,headG); box(0.03,0.2,0.03,'#222',0.2,-0.2,0,headG);
    } else if(type==='pot'){ // 湯鍋
      cyl(0.25,0.22,M('#d9dee6',{emissive:'#555a62'}),0,0.12,0,headG); cyl(0.27,0.03,M('#9aa1ab'),0,0.02,0,headG);
      box(0.12,0.04,0.05,'#2b2b2b',-0.32,0.15,0,headG); box(0.12,0.04,0.05,'#2b2b2b',0.32,0.15,0,headG);
    } else if(type==='hard'){ // 工程帽
      const h=new THREE.Mesh(HEMI,M('#ffcc00')); h.scale.set(0.24,0.24,0.26); h.position.y=0.04; headG.add(h);
      cyl(0.3,0.03,M('#ffcc00'),0,0.04,0.04,headG);
    } else if(type==='cap'){ box(0.4,0.12,0.4,'#1f4fbf',0,0.13,0,headG); box(0.3,0.03,0.2,'#1f4fbf',0,0.08,0.25,headG); }
    else if(type==='thief'){ const h=new THREE.Mesh(HEMI,M('#151515')); h.scale.set(0.215,0.2,0.215); h.position.y=0.01; headG.add(h); box(0.4,0.09,0.06,'#0a0a0a',0,0.02,0.17,headG); box(0.07,0.04,0.02,'#fff',-0.08,0.02,0.205,headG); box(0.07,0.04,0.02,'#fff',0.08,0.02,0.205,headG); }
    else if(type==='melon'){ const h=new THREE.Mesh(HEMI,M('#2f8a3a')); h.scale.set(0.27,0.24,0.27); h.position.y=0.0; headG.add(h); for(let k=0;k<4;k++){ const st=box(0.02,0.2,0.4,'#1b5e20',0,0.12,0,headG); st.rotation.y=k*Math.PI/4; } cyl(0.27,0.03,M('#e53935'),0,0.0,0,headG); }
    else if(type==='plastic'){ const h=new THREE.Mesh(new THREE.SphereGeometry(0.27,8,6),M('#f6f2ea')); h.scale.set(1,0.9,1); h.position.y=0.06; headG.add(h); for(const y of [-0.02,0.1,0.22]) cyl(0.255,0.035,M('#d32f2f'),0,y,0,headG); box(0.08,0.18,0.04,'#f6f2ea',-0.1,0.32,0,headG); box(0.08,0.18,0.04,'#f6f2ea',0.1,0.32,0,headG); }
    else if(type==='conehat'){ const c=new THREE.Mesh(new THREE.ConeGeometry(0.24,0.6,10),M('#ff6a00')); c.position.y=0.28; headG.add(c); cyl(0.17,0.08,M('#fff'),0,0.3,0,headG); }
    else if(type==='cooker'){ cyl(0.26,0.3,M('#d84a4a'),0,0.12,0,headG); const l=new THREE.Mesh(HEMI,M('#c9ced6')); l.scale.set(0.26,0.1,0.26); l.position.y=0.27; headG.add(l); box(0.08,0.06,0.08,'#222',0,0.38,0,headG); }
    else if(type==='police'){ const h=new THREE.Mesh(HEMI,M('#f5f5f5')); h.scale.set(0.27,0.3,0.27); headG.add(h); box(0.3,0.05,0.04,'#1a3a8a',0,0.07,0.25,headG); }
  }

  function wheel(r,w,x,y,z,p){ const m=cyl(r,w,'#151515',x,y,z,p,0,Math.PI/2); return m; }

  // 汽車
  const CAR_COLORS=['#f4f4f4','#c3c7cc','#1c1c1f','#b3202a','#2856a8','#6d7b8a','#e9e2d0'];
  function car(kind='sedan',color){
    const g=new THREE.Group(); let len=4.2,wid=1.9, lights=null;
    const glass=M('#24344a',{emissive:'#0b1422'});
    if(kind==='truck'){ // 藍色發財車
      color='#2f66c4'; len=4.6;
      box(1.85,1.3,1.4,color,0,1.15,1.55,g); box(1.7,0.55,0.05,glass,0,1.5,2.26,g);
      box(1.9,0.35,3.1,'#2a2f38',0,0.62,-0.6,g); box(1.9,0.5,0.06,color,0,1.05,-2.13,g);
      box(0.06,0.5,3.0,color,-0.92,1.05,-0.6,g); box(0.06,0.5,3.0,color,0.92,1.05,-0.6,g);
      for(const z of [1.5,-1.4]) for(const x of [-0.85,0.85]) wheel(0.36,0.25,x,0.36,z,g);
    } else {
      if(!color) color = kind==='taxi'?'#ffcf1a':(kind==='police'?'#f5f5f5':G.pick(CAR_COLORS));
      box(1.9,0.7,4.2,color,0,0.65,0,g);
      box(1.7,0.6,2.2,glass,0,1.28,-0.2,g); box(1.72,0.08,2.0,color,0,1.6,-0.25,g);
      for(const z of [1.35,-1.35]) for(const x of [-0.9,0.9]) wheel(0.36,0.25,x,0.36,z,g);
      if(kind==='taxi'){ box(0.6,0.25,0.3,'#fff',0,1.77,-0.2,g); box(1.92,0.12,4.22,'#111',0,0.75,0,g); }
      if(kind==='police'){ box(1.92,0.18,4.22,'#1a3a8a',0,0.8,0,g); lights=[new THREE.MeshLambertMaterial({color:'#ff2b2b',emissive:'#ff0000'}),new THREE.MeshLambertMaterial({color:'#2b6bff',emissive:'#0044ff'})]; box(0.6,0.18,0.34,lights[0],-0.33,1.72,-0.2,g); box(0.6,0.18,0.34,lights[1],0.33,1.72,-0.2,g); const tx=new THREE.Mesh(new THREE.PlaneGeometry(1.4,0.36),new THREE.MeshBasicMaterial({map:textTex('警察',{bg:'#1a3a8a',fg:'#fff',w:256,h:72})})); tx.rotation.x=-Math.PI/2; tx.position.set(0,1.65,0.6); g.add(tx); }
    }
    const fz=len/2; const hl=M('#fffbe0',{emissive:'#7a7350'});
    box(0.35,0.15,0.05,hl,-0.6,0.75,fz+0.01,g); box(0.35,0.15,0.05,hl,0.6,0.75,fz+0.01,g);
    box(0.35,0.15,0.05,M('#a00',{emissive:'#400'}),-0.6,0.75,-fz-0.01,g); box(0.35,0.15,0.05,M('#a00',{emissive:'#400'}),0.6,0.75,-fz-0.01,g);
    // 雙黃燈（各自材質才能閃）
    const hz=new THREE.MeshLambertMaterial({color:'#7a4a00',emissive:'#000'});
    const hzR=new THREE.MeshLambertMaterial({color:'#7a4a00',emissive:'#000'});
    for(const z of [fz,-fz]) for(const x of [-0.88,0.88]) box(0.16,0.12,0.08,x<0?hzR:hz,x,0.86,z,g);
    // 車牌
    box(0.55,0.15,0.03,'#fff',0,0.5,-fz-0.02,g);
    g.userData={len,wid,hazard:hz,hazardR:hzR,lights};
    return g;
  }

  // 機車
  const MOTO_COLORS=['#e8e8e8','#c62828','#1565c0','#2e7d32','#212121','#f9a825','#6a1b9a','#90a4ae'];
  function dog(p,x,y,z){
    const g=new THREE.Group(), c=G.pick(['#c8894a','#f2f2f2','#2b2b2b','#e0b56a']);
    box(0.28,0.28,0.6,c,0,0.42,0,g); box(0.24,0.24,0.26,c,0,0.62,0.36,g); box(0.08,0.1,0.06,'#222',0,0.6,0.5,g);
    box(0.06,0.12,0.06,c,-0.09,0.78,0.32,g); box(0.06,0.12,0.06,c,0.09,0.78,0.32,g);
    const legs=[]; for(const [lx,lz] of [[-0.09,0.2],[0.09,0.2],[-0.09,-0.2],[0.09,-0.2]]){ const l=new THREE.Group(); l.position.set(lx,0.3,lz); box(0.07,0.3,0.07,c,0,-0.15,0,l); g.add(l); legs.push(l); }
    const tail=box(0.05,0.05,0.25,c,0,0.55,-0.4,g); tail.rotation.x=-0.7;
    g.userData.legs=legs; g.position.set(x,y,z); p.add(g); return g;
  }
  function motoBody(g,color){
    wheel(0.3,0.12,0,0.3,0.68,g); wheel(0.3,0.12,0,0.3,-0.62,g);
    box(0.42,0.32,1.1,color,0,0.55,-0.1,g); box(0.36,0.14,0.75,'#222',0,0.8,-0.25,g);
    box(0.5,0.6,0.22,color,0,0.85,0.55,g); box(0.62,0.06,0.06,'#333',0,1.2,0.55,g);
    box(0.28,0.12,0.06,M('#fffbe0',{emissive:'#666'}),0,1.05,0.67,g);
  }
  // extras: stand / phone / umbrella / pet
  function moto({riders=['helmet'],cargo='none',color=G.pick(MOTO_COLORS),police=false,stand=false,phone=false,umbrella=false,pet=false}={}){
    const g=new THREE.Group(); const ud={len:1.9,wid:0.75};
    if(police) color='#f5f5f5';
    motoBody(g,color);
    if(police){ box(0.44,0.34,0.4,'#1a3a8a',0,0.9,-0.75,g); box(0.12,0.12,0.12,M('#ff2b2b',{emissive:'#f00'}),-0.15,1.15,-0.75,g); box(0.12,0.12,0.12,M('#2b6bff',{emissive:'#04f'}),0.15,1.15,-0.75,g); }
    const seats=[{z:0.05},{z:-0.48},{z:0.48,kid:true},{z:-0.95}];
    let driver=null;
    riders.forEach((h,i)=>{
      const s=seats[i]; let p;
      if(i===0&&stand){ p=person({head:h,scale:1.05}); p.position.set(0,0.55,0.1); const L=p.userData.legs; L[0].rotation.x=0.25; L[1].rotation.x=-0.25; }
      else { p=person({seated:true,head:h,scale:s.kid?0.82:1.08}); p.position.set(0,s.kid?0.12:-0.32,s.z-(s.kid?0.12:0.15)); }
      if(police&&p.userData.headG) setHead(p.userData.headG,'police');
      g.add(p); if(i===0) driver=p;
    });
    const top=stand?2.45:1.95;
    if(phone&&driver){ box(0.13,0.24,0.03,'#111',0.32,top-0.05,0.25,g); box(0.11,0.2,0.01,M('#9fe7ff',{emissive:'#4fc3ff'}),0.32,top-0.05,0.27,g); box(0.08,0.4,0.08,'#e0ac83',0.32,top-0.32,0.18,g); }
    if(umbrella){ const c=G.pick(['#e53935','#ffb300','#8e24aa','#1e88e5','#ff7aa8']); cyl(0.025,1.0,'#555',0.25,top+0.35,0.05,g); const u=new THREE.Mesh(new THREE.ConeGeometry(0.95,0.45,8),M(c)); u.position.set(0.25,top+0.95,0.05); g.add(u); }
    if(pet){ ud.dog=dog(g,0.85,0,0.3); const l=box(0.02,0.02,0.9,'#c62828',0.5,1.0,0.35,g); l.rotation.set(0.6,0,0.9); }
    if(cargo==='fridge'){ box(0.75,1.5,0.7,'#f4f6f8',0,1.6,-0.85,g); box(0.04,0.5,0.04,'#999',0.3,1.9,-0.49,g); box(0.8,0.04,0.74,'#c62828',0,1.25,-0.85,g); box(0.8,0.04,0.74,'#c62828',0,1.95,-0.85,g); }
    else if(cargo==='scooter'){ const m=new THREE.Group(); motoBody(m,G.pick(MOTO_COLORS)); m.scale.setScalar(0.85); m.position.set(0,1.0,-0.75); m.rotation.set(-0.5,Math.PI/2,0); g.add(m); box(0.9,0.04,0.04,'#c62828',0,1.3,-0.6,g); }
    else if(cargo==='ladder'){ box(4.2,0.09,0.09,'#9b8a3c',0,1.35,-0.7,g); box(4.2,0.09,0.09,'#9b8a3c',0,1.48,-0.82,g); for(const x of [-1.9,1.9]) box(0.12,0.12,0.12,'#e53935',x,1.4,-0.75,g); }
    else if(cargo==='gas'){ for(let k=0;k<3;k++){ cyl(0.22,0.7,M('#2e6fd6'),0,1.2+k*0.72,-0.8,g); cyl(0.08,0.12,'#999',0,1.6+k*0.72,-0.8,g); } }
    else if(cargo==='sofa'){ box(1.7,0.45,0.8,'#7b4fbf',0,1.25,-0.8,g); box(1.7,0.6,0.2,'#6a3fae',0,1.7,-1.15,g); box(0.2,0.35,0.8,'#6a3fae',-0.85,1.55,-0.8,g); box(0.2,0.35,0.8,'#6a3fae',0.85,1.55,-0.8,g); }
    else if(cargo==='bear'){ const c='#c8894a'; sph(0.55,c,0,1.65,-0.8,g); sph(0.4,c,0,2.45,-0.8,g); sph(0.14,c,-0.3,2.78,-0.8,g); sph(0.14,c,0.3,2.78,-0.8,g); sph(0.12,'#f3d9b1',0,2.4,-0.45,g); }
    else if(cargo==='box'){ box(0.45,0.3,0.4,'#c8a26b',0,1.0,-0.75,g); }
    else if(cargo==='bag'){ box(0.3,0.3,0.15,'#fff',0.2,0.95,0.45,g); }
    g.userData=ud;
    return g;
  }

  // 建築：街面在 z=0（騎樓柱），向 -z 延伸
  const FACADES=['#e9e4d8','#d8c9b4','#cfd8d2','#e6cfcf','#c9cfd8','#ded6c3','#b9b0a3','#e2dcc8'];
  const SIGNS=[['早餐店','#f39c12','#fff'],['檳榔','#1e9e5a','#fff'],['藥局','#1565c0','#fff'],['便當','#c62828','#fff'],['機車行','#222','#ffd21f'],['珍奶','#6d4c41','#fff'],['自助餐','#e65100','#fff'],['眼鏡行','#0d47a1','#fff'],['五金行','#2e7d32','#fff'],['牙醫診所','#00838f','#fff'],['補習班','#ad1457','#fff'],['雞排','#ff6f00','#111'],['電器行','#283593','#fff'],['麵店','#b71c1c','#fff']];
  const texCache={}; const GRILL=new THREE.MeshLambertMaterial({color:'#7b838e',wireframe:true});
  function signTex(name,bg,fg,vertical){ const k=name+vertical; return texCache[k]||(texCache[k]=textTex(name,{bg,fg,vertical,w:vertical?96:256,h:vertical?256:96})); }
  function building(w){
    const g=new THREE.Group(); const floors=G.ri(3,5), fh=3.1, d=10, H=floors*fh;
    const fc=G.pick(FACADES);
    box(w,H-3.2,d,fc,0,3.2+(H-3.2)/2,-d/2,g); // upper
    box(w,3.2,d-3,'#8c8577',0,1.6,-3-(d-3)/2,g); // ground recessed
    box(w*0.8,2.4,0.05,M('#2c3542',{emissive:'#0d1218'}),0,1.4,-2.97,g); // shop front
    box(w,0.12,3,'#b5aea0',0,3.15,-1.5,g);
    for(const x of [-w/2+0.3,w/2-0.3]) box(0.5,3.2,0.5,fc,x,1.6,-0.25,g);
    // windows + 鐵窗
    for(let f=1;f<floors;f++){ const y=f*fh+1.6;
      const n=Math.max(1,Math.floor(w/3.2));
      for(let i=0;i<n;i++){ const x=-w/2+(i+0.5)*w/n;
        box(w/n*0.6,1.3,0.06,M('#34465c',{emissive:'#0b1520'}),x,y,0.02,g);
        if(Math.random()<0.6){ box(w/n*0.66,1.45,0.5,GRILL,x,y,0.22,g); }
      }
    }
    // 招牌
    const s=G.pick(SIGNS);
    const hs=new THREE.Mesh(new THREE.PlaneGeometry(w*0.86,1.0),new THREE.MeshBasicMaterial({map:signTex(s[0],s[1],s[2],false)}));
    hs.position.set(0,3.75,0.08); g.add(hs);
    if(floors>=3 && Math.random()<0.7){ const s2=G.pick(SIGNS);
      const vs=new THREE.Mesh(new THREE.BoxGeometry(0.25,3.2,1.1),[M('#ddd'),M('#ddd'),M('#ddd'),M('#ddd'),new THREE.MeshBasicMaterial({map:signTex(s2[0],s2[1],s2[2],true)}),new THREE.MeshBasicMaterial({map:signTex(s2[0],s2[1],s2[2],true)})]);
      vs.rotation.y=Math.PI/2; vs.position.set(w/2-0.6,H-2.2,0.6); g.add(vs); }
    // 屋頂：水塔 / 鐵皮加蓋
    if(Math.random()<0.6){ cyl(0.7,1.3,'#e8e8e8',G.rand(-w/3,w/3),H+0.8,-d*0.6,g); box(1.2,0.15,1.2,'#555',0,H+0.07,-d*0.6,g); }
    if(Math.random()<0.45){ box(w*0.7,2.2,d*0.6,G.pick(['#2f6fb5','#3d8fd1','#7d8a96']),0,H+1.1,-d*0.55,g); }
    g.userData={H};
    return g;
  }

  function signalHead(mats){ // 面向 +z
    const g=new THREE.Group(); box(0.5,1.4,0.35,'#2a2d33',0,0,0,g); box(0.6,1.5,0.05,'#111',0,0,-0.2,g);
    const L=new THREE.CircleGeometry(0.16,12);
    [['r',0.42],['y',0],['g',-0.42]].forEach(([k,y])=>{ const m=new THREE.Mesh(L,mats[k]); m.position.set(0,y,0.18); g.add(m); });
    return g;
  }
  function cone(p,x,z){ const g=new THREE.Group(); const c=new THREE.Mesh(new THREE.ConeGeometry(0.28,0.75,10),M('#ff6a00')); c.position.y=0.42; g.add(c); box(0.6,0.06,0.6,'#222',0,0.03,0,g); box(0.42,0.1,0.42,'#fff',0,0.48,0,g).visible=false; g.position.set(x,0,z); if(p)p.add(g); return g; }
  function transformer(p,x,z,ry=0){ const g=new THREE.Group(); box(1.4,1.3,0.8,'#4f7f52',0,0.65,0,g); box(1.42,0.08,0.82,'#3c623e',0,1.32,0,g); const t=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.35),new THREE.MeshBasicMaterial({map:textTex('高壓危險',{bg:'#ffd21f',fg:'#111',w:256,h:96})})); t.position.set(0,0.9,0.41); g.add(t); g.position.set(x,0,z); g.rotation.y=ry; if(p)p.add(g); return g; }
  function betelStand(p,x,z,ry=0){
    const g=new THREE.Group(); box(2.4,2.3,1.8,'#d9d4c7',0,1.15,0,g); box(2.0,1.0,0.05,M('#5fd9a8',{emissive:'#1a6b4a'}),0,1.5,0.92,g);
    box(2.6,0.12,0.12,M('#ff3df2',{emissive:'#d000c8'}),0,2.36,0.95,g); box(2.6,0.12,0.12,M('#36f5ff',{emissive:'#00b8c8'}),0,0.1,0.95,g);
    const t=new THREE.Mesh(new THREE.PlaneGeometry(2.2,0.6),new THREE.MeshBasicMaterial({map:textTex('檳榔 香菸 飲料',{bg:'#0b0b0b',fg:'#ff4fe0',w:384,h:96})})); t.position.set(0,2.75,0.95); g.add(t);
    g.position.set(x,0,z); g.rotation.y=ry; if(p)p.add(g); return g;
  }
  function parkedScooters(p,x,z,n,ry=0){ const g=new THREE.Group(); for(let i=0;i<n;i++){ const m=moto({riders:[]}); m.rotation.y=Math.PI/2; m.position.set(i*0.85,0,0); g.add(m);} g.position.set(x,0,z); g.rotation.y=ry; if(p)p.add(g); return g; }

  return {M,box,cyl,sph,textTex,person,setHead,car,moto,building,signalHead,cone,transformer,betelStand,parkedScooters,SHIRTS};
})();
