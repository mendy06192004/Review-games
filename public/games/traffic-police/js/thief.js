// 大樓竊案事件：小偷沿著大樓外牆移動，玩家轉頭找到他後用網槍發射捕捉網
G.thief = (function(){
  const W=G.world, {box,M}=G.M;
  let th=null, next=28, nets=[], alarmT=0;
  const on={spawn(){},catch(){},escape(){}};
  const tmp=new THREE.Vector3();
  const hbMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});

  // 只挑「預設視角看得清楚、沒被擋住、正面朝向玩家」的外牆位置
  const rc=new THREE.Raycaster(), pv=new THREE.Vector3();
  let fails=0;
  function findSpot(camPos,vcam,relax){
    const c=W.BLDS.filter(b=>{ if(b.H<9) return false; const d=Math.hypot(b.g.position.x-camPos.x,b.g.position.z-camPos.z); return d>15&&d<48; });
    for(let k=0;k<60&&c.length;k++){
      const b=G.pick(c), ry=b.g.rotation.y, f={x:Math.sin(ry),z:Math.cos(ry)}, r={x:Math.cos(ry),z:-Math.sin(ry)};
      const tx=camPos.x-b.g.position.x, tz=camPos.z-b.g.position.z, tl=Math.hypot(tx,tz);
      if((tx*f.x+tz*f.z)/tl<0.35) continue;
      const floors=Math.round(b.H/3.1), fl=G.ri(1,Math.min(2,floors-1)), y=fl*3.1;
      const half=b.w/2-0.9;
      const ok=[-half,0,half].every(lx=>{
        pv.set(b.g.position.x+f.x*0.9+r.x*lx,y+1.5,b.g.position.z+f.z*0.9+r.z*lx);
        const p=pv.clone().project(vcam); if(relax!==2&&!(p.z<1&&Math.abs(p.x)<0.72&&p.y>-0.55&&p.y<0.75)) return false;
        if(relax) return true; const dir=pv.clone().sub(camPos), dist=dir.length(); rc.set(camPos,dir.normalize()); rc.far=dist-1.2;
        return relax||rc.intersectObjects(W.BLDS.map(o=>o.g),true).length===0;
      });
      if(ok) return {b,y,f};
    }
    return null;
  }
  function spawn(camPos,vcam){
    const spot=findSpot(camPos,vcam,fails>=5?2:fails>=2?1:0); if(!spot){ fails++; next=2; return; } fails=0;
    const {b,y,f}=spot, ry=b.g.rotation.y;
    const g=new THREE.Group(); g.position.set(b.g.position.x+f.x*0.5,y,b.g.position.z+f.z*0.5); g.rotation.y=ry; W.scene.add(g);
    box(b.w,0.18,0.75,'#9a948a',0,-0.09,0,g); // 窗台
    const p=G.M.person({shirt:'#1d1d1f',pants:'#2b2b2b',skin:'#e0ac83'});
    for(const yy of [0.98,1.18,1.38]) box(0.5,0.07,0.3,'#f2f2f2',0,yy,0,p);
    G.M.setHead(p.userData.headG,'thief');
    const sack=new THREE.Mesh(new THREE.SphereGeometry(0.36,10,8),M('#e3d6b5')); sack.position.set(0,1.25,-0.36); p.add(sack);
    box(0.08,0.2,0.08,'#c8b48a',0,1.62,-0.36,p);
    p.rotation.y=Math.PI; p.scale.setScalar(1.55); g.add(p);
    const mk=new THREE.Mesh(new THREE.ConeGeometry(0.45,0.9,4),new THREE.MeshBasicMaterial({color:'#ff2a2a'})); mk.rotation.x=Math.PI; mk.position.y=3.5; p.add(mk);
    const hb=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.6,1.4),hbMat); hb.position.y=1.1; p.add(hb);
    const al=new THREE.Mesh(new THREE.SphereGeometry(0.4,10,8),new THREE.MeshBasicMaterial({color:'#ff2020'}));
    al.position.set(b.w/2-0.6,b.H-y+0.4,0.3); g.add(al);
    th={g,p,hb,al,mk,b,y,lx:G.rand(-1,1),half:b.w/2-0.9,dir:G.chance(0.5)?1:-1,spd:G.rand(0.55,0.85),t:40,ammo:5,state:'run',flip:G.rand(2,4),pause:0};
    alarmT=0; on.spawn(th);
  }
  function remove(){ if(th){ W.scene.remove(th.g); th=null; } }
  function worldPos(out){ th.p.getWorldPosition(out); out.y+=1.1; return out; }

  function update(dt,camPos,vcam){
    for(const n of nets.slice()){
      n.t+=dt;
      if(!n.done){
        if(th&&th.state!=='caught') worldPos(n.to); // 網子會追著小偷飛
        const q=Math.min(1,n.t/n.dur);
        n.m.position.lerpVectors(n.from,n.to,q); n.m.position.y+=Math.sin(q*Math.PI)*0.6;
        n.m.scale.setScalar(0.4+q*1.6); n.m.rotation.y+=dt*8;
        if(q>=1){ n.done=true;
          if(th&&th.state!=='caught'&&worldPos(tmp).distanceTo(n.to)<2.5){
            th.state='caught'; th.ct=2.6; G.audio.cuff(); n.m.scale.setScalar(1); th.p.add(n.m); n.m.position.set(0,1.0,0); n.m.scale.set(1.9,2.8,1.9); n.stuck=true; on.catch(th);
          } else { n.vy=0; if(th&&th.ammo<=0&&th.state==='run'){ th.t=Math.min(th.t,1.5); } }
        }
      } else if(!n.stuck){ n.vy-=12*dt; n.m.position.y+=n.vy*dt; if(n.t>n.dur+1.5){ W.scene.remove(n.m); nets.splice(nets.indexOf(n),1); } }
    }
    if(!th){ next-=dt; if(next<=0){ spawn(camPos,vcam); if(th) next=G.rand(40,60); } return; }
    const L=th.p.userData.legs;
    th.al.visible=(th.t%0.5)<0.25||th.state==='caught';
    th.mk.position.y=3.5+Math.sin(performance.now()/160)*0.25; th.mk.rotation.y+=dt*3; th.mk.visible=th.state!=='caught';
    if(th.state==='run'){
      th.t-=dt; alarmT-=dt; if(alarmT<=0){ G.audio.alarm(); alarmT=3.5; }
      if(th.t<=0){ th.state='escape'; return; }
      th.flip-=dt; if(th.flip<=0){ if(Math.random()<0.5) th.pause=G.rand(1.2,2.2); else th.dir*=-1; th.flip=G.rand(2,4); }
      if(th.pause>0){ th.pause-=dt; L[0].rotation.x*=0.8; L[1].rotation.x*=0.8; th.p.userData.headG.rotation.y=Math.sin(performance.now()/300)*0.6; return; }
      th.lx+=th.dir*th.spd*dt; if(Math.abs(th.lx)>th.half){ th.lx=Math.sign(th.lx)*th.half; th.dir*=-1; }
      th.p.position.x=-th.lx; // 背對街道時左右相反
      const s=Math.sin(performance.now()/90)*0.5; L[0].rotation.x=s; L[1].rotation.x=-s;
      if(th.t<=0){ th.state='escape'; }
    } else if(th.state==='escape'){
      th.p.position.y+=2.4*dt; const s=Math.sin(performance.now()/70)*0.7; L[0].rotation.x=s; L[1].rotation.x=-s;
      if(th.p.position.y>th.b.H-th.y+0.5){ const t=th; remove(); on.escape(t); }
    } else if(th.state==='caught'){
      th.p.rotation.z=Math.sin(performance.now()/60)*0.12; th.ct-=dt;
      if(th.ct<=0){ for(const n of nets.slice()) if(n.stuck){ nets.splice(nets.indexOf(n),1); } remove(); }
    }
  }
  function fire(aim,camPos){
    if(!th||th.state==='caught'||th.ammo<=0) return false;
    th.ammo--; G.audio.net();
    const m=new THREE.Mesh(new THREE.IcosahedronGeometry(0.45,1),new THREE.MeshBasicMaterial({color:'#e8f6ff',wireframe:true}));
    const from=camPos.clone(); from.y-=0.4; m.position.copy(from); W.scene.add(m);
    const d=from.distanceTo(aim);
    nets.push({m,from,to:aim.clone(),t:0,dur:Math.min(0.9,Math.max(0.25,d/60))});
    return true;
  }
  return {
    on, update, fire, worldPos,
    get active(){ return !!th&&th.state!=='caught'; },
    get state(){ return th; },
    reset(){ remove(); for(const n of nets) W.scene.remove(n.m); nets=[]; next=28; },
  };
})();
