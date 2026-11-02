// 遊戲主控：輸入、鏡頭、模式切換、開單與計分
(function(){
  const $=id=>document.getElementById(id);
  const W=G.world, N=G.npc, C=G.chase;
  const SHIFT=180;

  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  $('app').appendChild(renderer.domElement);
  const cam=new THREE.PerspectiveCamera(50,1,0.5,400);
  // 第一人稱：員警站在右下角交通崗台上，可轉頭環顧
  const EYE=new THREE.Vector3(11.5,7.2,11.5), lookAt=new THREE.Vector3();
  const look={yaw:0,pitch:0,zoom:false};
  const YAW0=Math.atan2(-1,-1), YAWMAX=1.6; // 只能左右轉，約 ±92°
  function resetLook(){ look.yaw=YAW0; look.pitch=innerWidth<innerHeight?-0.34:-0.25; }
  const vcam=new THREE.PerspectiveCamera(56,1,0.5,400); // 預設視角，用來讓小偷出現在畫面內
  resetLook();
  function placeCam(){
    const port=innerWidth<innerHeight, fov=look.zoom?(port?36:24):(port?84:64);
    if(Math.abs(cam.fov-fov)>0.05){ cam.fov+=(fov-cam.fov)*0.25; cam.updateProjectionMatrix(); }
    look.pitch=innerWidth<innerHeight?-0.34:-0.25; look.yaw=Math.max(YAW0-YAWMAX,Math.min(YAW0+YAWMAX,look.yaw));
    const cp=Math.cos(look.pitch);
    cam.position.copy(EYE);
    lookAt.set(EYE.x+Math.sin(look.yaw)*cp,EYE.y+Math.sin(look.pitch),EYE.z+Math.cos(look.yaw)*cp); cam.lookAt(lookAt);
  }
  function resize(){ const w=innerWidth,h=innerHeight; renderer.setSize(w,h); cam.aspect=w/h; cam.updateProjectionMatrix(); C.resize(w,h); }
  addEventListener('resize',resize); resize();

  // ---------- 遊戲狀態 ----------
  const FRESH=()=>({dui:0,accDone:0,accMiss:0,supTickets:0,thieves:0,thiefMiss:0,sharp:0,score:0,warns:0,tickets:0,perfect:0,fines:0,chase:0,wrong:0,time:0,sel:null,lock:false,ticketNo:1,vCount:{},streak:0,bestStreak:0,warnOnly:0,cleanChase:0,towed:0,escTickets:0});
  const S=Object.assign({mode:'START'},FRESH());
  function hud(){
    const m=Math.floor(S.time/SHIFT*240); $('hClock').textContent=String(8+Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    $('hScore').textContent=S.score; $('hTickets').textContent=S.tickets;
    [...$('hWarn').children].forEach((d,i)=>d.classList.toggle('on',i<S.warns));
    $('pdaTime').textContent=$('hClock').textContent;
  }
  function toast(msg,kind=''){ const t=document.createElement('div'); t.className='toast '+kind; t.textContent=msg; $('toasts').appendChild(t); setTimeout(()=>t.remove(),3200); while($('toasts').children.length>3) $('toasts').firstChild.remove(); }
  const bubbles=[];
  function bubble(npc,text,angry){ if(npc.dead) return; const el=document.createElement('div'); el.className='bubble'+(angry?' angry':''); el.textContent=text; $('bubbles').appendChild(el); bubbles.push({el,npc,t:2.8,pos:npc.pos.clone()}); }

  // ---------- 選取 ----------
  const ray=new THREE.Raycaster(), v3=new THREE.Vector3();
  function project(p,yOff=1){ v3.set(p.x,p.y+yOff,p.z).project(cam); return {x:(v3.x+1)/2*innerWidth,y:(1-v3.y)/2*innerHeight,z:v3.z}; }
  function selectable(o){ return !o.dead&&!o.ticketed&&o.state==='MOVE'; }
  function tap(x,y){
    if(S.mode!=='PATROL'||S.lock) return;
    if(TUT.on&&tutStep().allow!=='select') return;
    ray.setFromCamera({x:x/innerWidth*2-1,y:-(y/innerHeight)*2+1},cam);
    if(ACC.cur){ const a=ACC.cur, h=ray.intersectObject(a.hit,false), sp=project(a.pos,0);
      if(h.length||(sp.z<1&&Math.hypot(sp.x-x,sp.y-y)<110)){ openAcc(); return; } }
    if(G.thief.active){
      const th=G.thief.state, h=ray.intersectObject(th.hb,false);
      let aim=h.length?h[0].point:null;
      if(!aim){ const wp=G.thief.worldPos(new THREE.Vector3()), s=project(wp,0); if(s.z<1&&Math.hypot(s.x-x,s.y-y)<85) aim=wp; }
      if(aim){ if(G.thief.fire(aim,cam.position)) updThief(); return; }
    }
    const hits=ray.intersectObjects(N.list.filter(selectable).map(o=>o.hit),false);
    let pick=hits.length?hits[0].object.userData.npc:null;
    if(!pick){ let best=64; for(const o of N.list){ if(!selectable(o)) continue; const s=project(o.pos); if(s.z>1) continue; const d=Math.hypot(s.x-x,s.y-y); if(d<best){best=d;pick=o;} } }
    if(TUT.on&&pick!==TUT.npc) return;
    if(pick&&pick===S.sel){ whistle(); return; }
    if(pick){ select(pick); G.audio.click(); } else select(null);
  }
  function select(o){
    S.sel=o; $('target').hidden=!o; $('scan').hidden=!o; $('pip').hidden=!o; $('hint').hidden=!!o||S.mode!=='PATROL'||TUT.on;
    if(o){ $('tKind').textContent=o.kind==='ped'?'鎖定行人':o.kind==='parked'?'鎖定停放車輛':'鎖定車輛'; $('tName').textContent=o.label; $('tPlate').textContent=o.plate; $('scanTag').textContent=o.plate; }
  }

  // ---------- 吹哨 ----------
  function whistle(){
    const o=S.sel; if(!o||S.mode!=='PATROL'||S.lock) return;
    if(TUT.on&&tutStep().allow!=='shoot') return;
    G.audio.shot(); shootFx(o); N.halt(o); select(null); S.lock=true;
    if(!o.actual.size&&o.isVeh){ setTimeout(()=>wrongStop(o),500); return; }
    if(!o.actual.size){
      S.score-=200; S.warns++; S.wrong++; hud();
      setTimeout(()=>{ bubble(o,G.pick(G.COMPLAIN),true); G.audio.bad(); toast('攔到守法民眾！考績 −200，警告 +1','bad'); },450);
      setTimeout(()=>{ N.release(o); S.lock=false; if(S.warns>=3) endGame(true); },1800);
      return;
    }
    let esc=0; for(const k of o.actual) esc=Math.max(esc,G.VIOL[k].esc);
    if(o.tut) esc=0;
    if(o.kind==='parked') esc=o.dbl?esc:0;
    if(G.chance(esc)){
      setTimeout(()=>{ bubble(o,'逃逸中！',true); toast('對方拒捕逃逸！追上去！','bad'); },350);
      setTimeout(()=>{ S.lock=false; startChase(o); },1300);
    } else setTimeout(()=>{ S.lock=false; openPDA(o); },600);
  }

  // ---------- PDA 開單 ----------
  let pdaNpc=null;
  function openPDA(o,escaped){
    pdaNpc=o; o.escaped=!!escaped; S.mode='PDA';
    $('pdaEsc').hidden=!escaped; $('pdaWarn').textContent=escaped?'只開逃逸罰單':'口頭勸導放行';
    $('pdaEscNo').textContent=escaped?'No.'+String(S.ticketNo+1).padStart(5,'0'):'';
    $('pdaNo').textContent='No.'+String(S.ticketNo).padStart(5,'0');
    $('pdaWho').textContent=o.label; $('pdaPlate').textContent=o.plate;
    const first=[...o.actual][0]; $('pdaPlea').textContent=escaped?G.pick(G.ESC_PLEAS):G.pick(G.PLEAS[first]||['長官拜託啦…']);
    const L=$('pdaList'); L.innerHTML='';
    G.OPTIONS[o.otype].forEach(k=>{
      const v=G.CATS[k], lab=document.createElement('label'); lab.htmlFor='v_'+k;
      lab.innerHTML=`<input type="checkbox" id="v_${k}" value="${k}"><span class="law">${v.law||'—'}</span><span>${v.title}</span><span class="fine">${v.range}</span>`;
      lab.querySelector('input').addEventListener('change',e=>{ lab.classList.toggle('on',e.target.checked); G.audio.click(); });
      L.appendChild(lab);
    });
    $('pda').hidden=false; $('hud').hidden=true; $('hint').hidden=true;
    hud();
  }
  function closePDA(){ $('pda').hidden=true; $('hud').hidden=false; S.mode='PATROL'; $('hint').hidden=false; pdaNpc=null; }
  function names(keys){ return [...new Set(keys.map(k=>G.CAT[k]||k))].map(c=>G.CATS[c]?G.catName(c):c).join('、'); }
  function catNames(cs){ return cs.map(G.catName).join('、'); }
  function issue(){
    const o=pdaNpc; if(!o) return;
    const sel=[...$('pdaList').querySelectorAll('input:checked')].map(i=>i.value);
    if(!sel.length){ toast('至少勾選一項違規，或選擇口頭勸導'); return; }
    const act=G.cats(o), right=sel.filter(c=>act.includes(c)), wrong=sel.filter(c=>!act.includes(c)), miss=act.filter(c=>!sel.includes(c));
    const fine=right.reduce((s,c)=>s+G.CATS[c].fine,0), beh=[...o.actual];
    S.ticketNo++;
    if(wrong.length){
      S.score-=50; S.streak=0; G.audio.bad(); toast(`罰單勾錯被檢舉作廢！考績 −50　正解：${catNames(act)}`,'bad'); bubble(o,'我才沒有'+G.catName(wrong[0])+'！',true);
    } else if(miss.length){
      const pts=15*right.length; S.streak=0; beh.forEach(k=>S.vCount[k]=(S.vCount[k]||0)+1); S.score+=pts; S.fines+=fine; S.tickets++; G.audio.good();
      toast(`部分成立 +${pts}　漏開：${catNames(miss)}`); bubble(o,G.pick(G.THANKS));
    } else {
      S.streak++; S.bestStreak=Math.max(S.bestStreak,S.streak); beh.forEach(k=>S.vCount[k]=(S.vCount[k]||0)+1);
      const pts=40*right.length+(right.length>1?30:0); S.score+=pts; S.fines+=fine; S.tickets++; S.perfect++; G.audio.good();
      toast(`完美罰單！考績 +${pts}　罰鍰 NT$${fine}`,'good'); bubble(o,G.pick(G.THANKS));
    }
    finish(o,!wrong.length); TUT.flags.issued=true;
  }
  function warnOnly(){ const o=pdaNpc; if(!o) return; if(!o.escaped){ S.warnOnly++; toast('口頭勸導放行，下次注意'); bubble(o,'謝謝長官！'); } finish(o,false); }
  function finish(o,ok){
    if(o.escaped){ S.ticketNo++; S.tickets++; S.escTickets++; S.fines+=G.VIOL.ESCAPE.fine; S.score+=100;
      setTimeout(()=>toast(`追加逃逸罰單 ${G.CATS.ESCAPE.range}（以 NT$${G.CATS.ESCAPE.min.toLocaleString()} 計），考績 +100`,'good'),500); }
    if(o.dead){}
    else if(o.kind==='parked'&&ok){ S.towed++; N.tow(o); setTimeout(()=>toast('拖吊車已將違停車輛拖走'),400); }
    else N.release(o);
    closePDA(); hud();
  }

  // ---------- 追逐 ----------
  function startChase(o){
    S.mode='CHASE'; N.remove(o); select(null); $('thiefBar').hidden=true; $('thiefArrow').hidden=true;
    $('hud').hidden=true; $('hint').hidden=true; $('chase').hidden=false;
    $('chTitle').textContent='逃逸中！警車出動！';
    $('chKeys').hidden=matchMedia('(pointer:coarse)').matches; $('chCap').hidden=true;
    C.start(o,res=>{
      $('chase').hidden=true; $('chase').classList.remove('cin'); $('hud').hidden=false; $('hint').hidden=false; S.mode='PATROL';
      if(res.win){ S.score+=150; S.chase++; if(res.clean) S.cleanChase++; if(res.sharp) S.sharp++; G.audio.good(); toast('成功逮捕！考績 +150　現場開單','good'); hud(); openPDA(o,true); }
      else { S.score-=60; S.streak=0; G.audio.bad(); toast(res.why+'　考績 −60','bad'); hud(); }
    });
  }
  function chaseHud(){
    const st=C.state; if(!st) return; const max=75;
    $('chase').classList.toggle('cin',st.phase==='capture');
    if(st.phase==='capture'){ if(st.cap.pinned&&$('chCap').hidden){ $('chCap').hidden=false; } return; }
    $('chSpd').textContent=Math.round(st.pSpeed*3.6);
    $('chNitro').style.width=Math.round(st.nitro*100)+'%'; $('btnBoost').classList.toggle('full',st.nitro>=0.5); $('btnBoost').classList.toggle('on',st.boost>0);
    const fx=$('chFx'); fx.style.opacity=Math.min(1,Math.max(0,(st.pSpeed-33)/22)+(st.boost>0?0.55:0)); fx.style.setProperty('--a',(Math.random()*9).toFixed(1)+'deg');
    $('chHit').style.opacity=Math.min(1,st.hitFx*2.2);
    while(st.pops.length){ const p=st.pops.shift(), el=$('chPop'); el.textContent=p.text; el.className='ch-pop'; void el.offsetWidth; el.className='ch-pop show '+(p.kind||''); }
    $('chBar').style.width=Math.max(4,100-st.dist/max*100)+'%';
    $('chDist').textContent=Math.round(st.dist)+'m'; $('chTime').textContent=Math.max(0,Math.ceil(st.time));
    $('chHp').textContent='♥'.repeat(Math.max(0,st.hp))+'♡'.repeat(Math.max(0,3-st.hp));
    $('btnFire').classList.toggle('ready',st.ready);
    $('chTire').textContent='●'.repeat(st.tire)+'○'.repeat(Math.max(0,st.need-st.tire));
    const sp=C.screenPos(), rt=$('chRet'); if(sp&&sp.on){ rt.hidden=false; rt.style.left=sp.x+'px'; rt.style.top=sp.y+'px'; rt.classList.toggle('in',sp.inRange); } else rt.hidden=true;
    $('btnSiren').classList.toggle('cd',st.sirenCd>0);
  }

  // ---------- 開始／結束 ----------
  function startGame(){
    endTutorial();
    G.audio.init();
    Object.assign(S,FRESH(),{mode:'PATROL'});
    closeDlg(); $('accModal').hidden=true; ACC.cur=null; ACC.cd=25; endSupport(); SUP.made=0; W.reset(); N.density=0.3; N.init(); G.thief.reset(); resetLook(); look.zoom=false; $('btnZoom').classList.remove('on');
    $('startScreen').hidden=true; $('endScreen').hidden=true; $('hud').hidden=false; $('hint').hidden=false;
    bubbles.splice(0).forEach(b=>b.el.remove());
    hud(); toast('早班開始！盯緊路口');
  }
  function endGame(fired){
    endSupport(); closeDlg(); $('accModal').hidden=true; $('accBar').hidden=true; S.mode='END'; select(null); $('thiefBar').hidden=true; $('thiefArrow').hidden=true; $('hud').hidden=true; $('hint').hidden=true; $('pda').hidden=true;
    let rank; if(fired) rank='山區派出所報到，記得帶外套';
    else rank=S.score<0?'交通大隊吉祥物':S.score<300?'菜鳥實習警員':S.score<700?'路口守護神':'交通之神';
    $('endTitle').textContent=fired?'你被調職了':'下班囉！'; $('endBadge').textContent=fired?'TRANSFER NOTICE':'SHIFT REPORT';
    $('endRank').textContent=rank;
    $('eScore').textContent=S.score; $('eTickets').textContent=S.tickets; $('ePerfect').textContent=S.perfect;
    $('eFines').textContent='$'+S.fines.toLocaleString(); $('eChase').textContent=S.chase; $('eWrong').textContent=S.wrong;
    renderBadges();
    setTimeout(()=>{ $('endScreen').hidden=false; },fired?600:0);
  }

  // ---------- 攔停槍特效 ----------
  const fx=[], UPV=new THREE.Vector3(0,1,0);
  function shootFx(o,src){
    let from; if(src){ from=src.clone(); } else { from=EYE.clone(); from.y-=0.55; const side=new THREE.Vector3(Math.cos(look.yaw),0,-Math.sin(look.yaw)); from.addScaledVector(side,-0.35); }
    const to=o.pos.clone(); to.y+=o.kind==='ped'?1.2:1.0;
    const d=to.clone().sub(from), len=d.length();
    const tr=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,len,4),new THREE.MeshBasicMaterial({color:'#ffe680'}));
    tr.position.copy(from).addScaledVector(d,0.5); tr.quaternion.setFromUnitVectors(UPV,d.clone().normalize()); W.scene.add(tr); fx.push({m:tr,t:0.08});
    const sp=new THREE.Mesh(new THREE.SphereGeometry(0.35,8,6),new THREE.MeshBasicMaterial({color:'#ffb000'})); sp.position.copy(to); W.scene.add(sp); fx.push({m:sp,t:0.2,grow:true});
    const st=new THREE.Group(); for(let i=0;i<3;i++){ const s=new THREE.Mesh(new THREE.OctahedronGeometry(0.16),new THREE.MeshBasicMaterial({color:'#ffd21f'})); s.position.set(Math.cos(i*2.1)*0.45,0,Math.sin(i*2.1)*0.45); st.add(s); }
    st.position.copy(o.pos); st.position.y+=o.kind==='ped'?2.1:o.kind==='moto'?2.4:2.3; W.scene.add(st); fx.push({m:st,t:1.6,spin:true,npc:o});
  }
  function updFx(dt){ for(const f of fx.slice()){ f.t-=dt; if(f.grow) f.m.scale.multiplyScalar(1+dt*7); if(f.spin){ f.m.rotation.y+=dt*6; if(!f.npc.dead){ f.m.position.x=f.npc.pos.x; f.m.position.z=f.npc.pos.z; } } if(f.t<=0){ W.scene.remove(f.m); fx.splice(fx.indexOf(f),1); } } }

  // ---------- 請求支援 ----------
  const SUP={on:false,t:0,next:0,need:250,cost:150,g:null,cop:null,made:0};
  const SUP_POS=new THREE.Vector3(-9.6,0,-9.6);
  function supBtn(){
    const b=$('btnSupport'); if(!b) return;
    if(SUP.on){ b.textContent=`支援中 ${Math.ceil(SUP.t)}s`; b.classList.add('on'); b.classList.remove('lock'); }
    else { b.textContent='請求支援'; b.classList.remove('on'); b.classList.toggle('lock',S.score<SUP.need); }
  }
  function callSupport(){
    if(S.mode!=='PATROL'||SUP.on) return;
    if(S.score<SUP.need){ toast(`考績達 ${SUP.need} 才能請求支援（目前 ${S.score}）`); G.audio.click(); return; }
    S.score-=SUP.cost; SUP.on=true; SUP.t=30; SUP.next=2.2; hud();
    const g=new THREE.Group();
    const cop=G.M.person({head:'police',shirt:'#1d3f8a',pants:'#1a2340',skin:'#e0ac83'}); G.M.box(0.52,0.42,0.32,new THREE.MeshLambertMaterial({color:'#c6f23a',emissive:'#3a4a00'}),0,1.2,0,cop);
    cop.scale.setScalar(1.25); g.add(cop);
    const m=G.M.moto({riders:[],police:true}); m.position.set(1.4,0,0.4); m.rotation.y=0.6; g.add(m);
    g.position.copy(SUP_POS); W.scene.add(g); SUP.g=g; SUP.cop=cop;
    G.audio.whistle(); toast(`支援警力抵達對面路口！考績 −${SUP.cost}，30 秒內幫你抓違規`,'good'); supBtn();
  }
  function endSupport(msg){ if(SUP.g) W.scene.remove(SUP.g); SUP.g=null; SUP.on=false; if(msg) toast(msg); supBtn(); }
  function updSupport(dt){
    if(!SUP.on){ supBtn(); return; }
    SUP.t-=dt; SUP.next-=dt; supBtn();
    if(SUP.t<=0){ endSupport(`支援同仁收隊，幫你開了 ${SUP.made} 張單`); SUP.made=0; return; }
    if(SUP.next>0) return; SUP.next=G.rand(2.8,4.2);
    let best=null, bd=42;
    for(const o of N.list){ if(o.dead||o.ticketed||o.state!=='MOVE'||!o.actual.size||o===S.sel) continue; const d=o.pos.distanceTo(SUP_POS); if(d<bd){ bd=d; best=o; } }
    if(!best) return;
    const o=best; SUP.cop.rotation.y=Math.atan2(o.pos.x-SUP_POS.x,o.pos.z-SUP_POS.z);
    const src=SUP_POS.clone(); src.y=1.9; G.audio.shot(); shootFx(o,src); N.halt(o); bubble(o,'哎唷！',true);
    setTimeout(()=>{
      if(o.dead) return;
      const keys=[...o.actual], fine=G.fineOf(o), pts=25*G.cats(o).length;
      S.tickets++; S.fines+=fine; S.score+=pts; S.supTickets++; SUP.made++;
      keys.forEach(k=>S.vCount[k]=(S.vCount[k]||0)+1);
      if(o.kind==='parked'){ N.tow(o); S.towed++; } else N.release(o);
      bubble(o,G.pick(G.THANKS)); toast(`同仁開單：${names(keys)}　+${pts}`,'good'); hud();
    },1300);
  }

  // ---------- 視角控制 ----------
  function toggleZoom(){ look.zoom=!look.zoom; $('btnZoom').classList.toggle('on',look.zoom); G.audio.click(); }
  function keyLook(dt){
    const k=1.6*dt*cam.fov/56;
    if(held.has('arrowleft')||held.has('a')) look.yaw+=k; if(held.has('arrowright')||held.has('d')) look.yaw-=k;
  }
  // ---------- 小偷事件 ----------
  const thv=new THREE.Vector3();
  G.thief.on.spawn=()=>{ toast('大樓竊案！轉頭找出外牆上的小偷，點他發射網槍','bad'); };
  G.thief.on.catch=()=>{ S.thieves++; S.score+=200; G.audio.good(); toast('網住小偷了！考績 +200','good'); hud(); };
  G.thief.on.escape=()=>{ S.thiefMiss++; S.score-=80; G.audio.bad(); toast('小偷爬上屋頂跑掉了…考績 −80','bad'); hud(); };
  function updThief(){
    const th=G.thief.state, bar=$('thiefBar'), ar=$('thiefArrow');
    if(!th||th.state==='caught'||S.mode!=='PATROL'){ bar.hidden=true; ar.hidden=true; return; }
    bar.hidden=false; $('thTime').textContent=Math.max(0,Math.ceil(th.t)); $('thAmmo').textContent='●'.repeat(th.ammo)+'○'.repeat(Math.max(0,5-th.ammo));
    G.thief.worldPos(thv); const p=thv.clone().project(cam);
    const on=p.z<1&&Math.abs(p.x)<0.92&&Math.abs(p.y)<0.85;
    if(on){ ar.hidden=true; return; }
    let dx=p.x, dy=p.y; if(p.z>1){ dx=-dx; dy=-dy; }
    const a=Math.atan2(-dy,dx), cx=innerWidth/2, cy=innerHeight/2, rx=cx-46, ry=cy-60;
    const t=Math.min(rx/Math.abs(Math.cos(a)||1e-6),ry/Math.abs(Math.sin(a)||1e-6));
    ar.hidden=false; ar.style.left=(cx+Math.cos(a)*t)+'px'; ar.style.top=(cy+Math.sin(a)*t)+'px'; ar.querySelector('i').style.transform=`rotate(${a}rad)`;
  }

  // ---------- 對話框（誤攔補救：酒測） ----------
  function showDlg({title,text,buttons,gauge}){
    $('dlgTitle').textContent=title; $('dlgText').textContent=text; $('dlgGauge').hidden=!gauge;
    const b=$('dlgBtns'); b.innerHTML='';
    (buttons||[]).forEach(o=>{ const e=document.createElement('button'); e.className='btn '+(o.cls||''); e.textContent=o.label; e.onclick=()=>{ G.audio.click(); o.fn(); }; b.appendChild(e); });
    $('dlg').hidden=false; $('hud').hidden=true; $('hint').hidden=true;
  }
  function closeDlg(){ $('dlg').hidden=true; }
  function backToPatrol(){ closeDlg(); $('hud').hidden=false; $('hint').hidden=false; S.mode='PATROL'; S.lock=false; hud(); if(S.warns>=3) endGame(true); }
  function wrongStop(o){
    S.mode='DLG';
    showDlg({title:'這位駕駛看起來沒有違規…',text:`民眾：「${G.pick(G.COMPLAIN)}」\n要順勢實施酒測補救嗎？抓到酒駕就不算誤攔。`,buttons:[
      {label:'道歉放行（考績 −100）',cls:'ghost',fn:()=>{ S.score-=100; S.wrong++; bubble(o,'下次看清楚啦！',true); N.release(o); toast('已向民眾道歉，考績 −100'); backToPatrol(); }},
      {label:'實施酒測',cls:'primary',fn:()=>breath(o)} ]});
  }
  function breath(o){
    const drunk=Math.random()<0.32, val=drunk?G.rand(0.18,0.68):G.rand(0,0.06);
    showDlg({title:'酒精濃度檢測中…',text:'請民眾對著吹嘴用力吹氣——',gauge:true,buttons:[]});
    const bar=$('dlgBar'), num=$('dlgVal'); bar.style.width='0%'; bar.classList.remove('bad'); num.textContent='0.00';
    const t0=performance.now();
    (function tick(now){ const q=Math.min(1,(now-t0)/1800), v=val*q;
      bar.style.width=Math.min(100,v/0.8*100)+'%'; num.textContent=v.toFixed(2); bar.classList.toggle('bad',v>=0.15);
      if(q<1) requestAnimationFrame(tick); else setTimeout(()=>result(),300); })(t0);
    function result(){
      if(drunk){ G.audio.good();
        showDlg({title:`酒測值 ${val.toFixed(2)} mg/L・超標！`,text:'標準是 0.15 mg/L。歪打正著，抓到酒駕了！車輛移置保管。',gauge:true,buttons:[
          {label:`開立酒駕罰單 ${G.CATS[o.kind==='moto'?'DUI_M':'DUI_C'].range}`,cls:'red',fn:()=>{ S.score+=150; S.dui++; S.tickets++; S.fines+=G.CATS[o.kind==='moto'?'DUI_M':'DUI_C'].fine; S.ticketNo++; N.tow(o); toast('酒駕罰單開立！考績 +150','good'); backToPatrol(); }} ]});
      } else { G.audio.bad();
        showDlg({title:`酒測值 ${val.toFixed(2)} mg/L・合格`,text:'民眾完全清醒，而且更生氣了…',gauge:true,buttons:[
          {label:'只好放行（考績 −250，警告 +1）',cls:'ghost',fn:()=>{ S.score-=250; S.warns++; S.wrong++; bubble(o,G.pick(G.COMPLAIN),true); N.release(o); toast('誤攔又酒測合格，考績 −250，警告 +1','bad'); backToPatrol(); }} ]});
      }
    }
  }

  // ---------- 車禍處理 ----------
  const ACC={cur:null,cd:25,t:0,step:0};
  const ACC_STEPS=['放置警示三角錐','救護傷患（通報 119）','拍照蒐證','現場測繪','肇事者酒測','移置車輛恢復交通'];
  N.crashOK=()=>S.mode==='PATROL'&&!TUT.on&&!ACC.cur&&ACC.cd<=0&&S.time>15;
  N.ev.crash=a=>{ ACC.cur=a; ACC.t=40; ACC.cd=38; G.audio.crash(); setTimeout(()=>G.audio.alarm(),300); toast('路口發生車禍！點紅色三角形前往處理','bad'); };
  function updAcc(dt){
    ACC.cd-=dt; const bar=$('accBar');
    if(!ACC.cur){ bar.hidden=true; return; }
    ACC.t-=dt; bar.hidden=S.mode!=='PATROL'; $('accTime').textContent=Math.max(0,Math.ceil(ACC.t)); $('accLeft').textContent=Math.max(0,Math.ceil(ACC.t));
    if(ACC.t<=0){ S.score-=150; S.accMiss++; toast('車禍放著沒處理，民眾投訴！考績 −150','bad'); N.clearCrash(ACC.cur); ACC.cur=null; $('accModal').hidden=true; if(S.mode==='ACC') backToPatrol(); hud(); }
  }
  function openAcc(){
    S.mode='ACC'; select(null); ACC.step=0; $('hud').hidden=true; $('hint').hidden=true; $('accBar').hidden=true;
    const v=ACC.cur.v; $('accWho').textContent=v.label.replace(/・右轉|（右轉）/,'')+'　'+v.plate;
    renderAcc(); $('accModal').hidden=false; G.audio.whistle();
  }
  function renderAcc(){
    $('accDone').innerHTML=ACC_STEPS.map((s,i)=>`<li class="${i<ACC.step?'ok':i===ACC.step?'cur':''}">${i<ACC.step?'✔':i+1}. ${i<=ACC.step?s:'？？？'}</li>`).join('');
    const b=$('accBtns'); b.innerHTML='';
    ACC_STEPS.map((s,i)=>({s,i})).filter(o=>o.i>=ACC.step).sort(()=>Math.random()-0.5).forEach(o=>{
      const e=document.createElement('button'); e.className='btn ghost'; e.textContent=o.s;
      e.onclick=()=>{ if(o.i===ACC.step){ G.audio.click(); ACC.step++; if(ACC.step>=ACC_STEPS.length) doneAcc(); else renderAcc(); }
        else { G.audio.bad(); ACC.t-=3; e.classList.add('shake'); setTimeout(()=>e.classList.remove('shake'),300); toast(`順序不對！應該先「${ACC_STEPS[ACC.step]}」（−3 秒）`,'bad'); } };
      b.appendChild(e); });
  }
  function doneAcc(){
    const a=ACC.cur, v=a.v, cs=G.cats(v), fine=G.fineOf(v), pts=150+Math.max(0,Math.round(ACC.t*3));
    S.score+=pts; S.accDone++; S.tickets++; S.fines+=fine; S.ticketNo++;
    toast(`車禍處理完成！考績 +${pts}　肇事者：${catNames(cs)||'肇事'}`,'good');
    N.clearCrash(a); ACC.cur=null; $('accModal').hidden=true; G.audio.good(); backToPatrol();
  }

  // ---------- 手把手新手教學 ----------
  const TUT={on:false,i:0,npc:null,yaw0:0,flags:{}};
  const TSTEPS=[
    {text:'歡迎報到！我是帶你的學長阿明。今天是你第一天在中正路口站崗，我帶你走一遍。',btn:'好，學長請說'},
    {el:'@chips',text:'上面這排是執勤時間、考績、警告和罰單數。警告累積 3 次，就會被調去山區吹冷風。',btn:'下一步'},
    {free:true,text:'先熟悉環境：在畫面上左右拖曳，轉頭看看四周。',enter:()=>{ TUT.yaw0=look.yaw; },until:()=>Math.abs(look.yaw-TUT.yaw0)>0.35},
    {world:new THREE.Vector3(-8.4,5.2,-3.2),r:52,text:'很好！這是對面的紅綠燈，燈頭正對著你。有人闖紅燈或紅燈右轉時，燈桿上的科技執法相機會閃白光。',btn:'了解',enter:()=>resetLook()},
    {npc:'helmetless',allow:'select',text:'有一台機車騎過來，停在路口了。點一下框框裡的機車，把它鎖定。',until:()=>S.sel===TUT.npc},
    {el:'pip',text:'右下角跳出了特寫鏡頭。仔細看——他頭上戴的是「湯鍋」，不是安全帽！',btn:'真的欸'},
    {el:'btnWhistle',allow:'shoot',text:'按「開槍攔停」把他定住。（正式執勤時，對鎖定的目標再點一次也能開槍）',until:()=>S.mode==='PDA'},
    {el:'v_HELMET',label:true,allow:'check',text:'這是執法 PDA，選項就是罰單上的條款。勾選「第31條第6項 未依規定戴安全帽」。',until:()=>{ const c=$('v_HELMET'); return c&&c.checked; }},
    {el:'pdaIssue',allow:'issue',text:'按「開立罰單」。勾錯任何一項整張作廢，漏勾只算部分成立。',enter:()=>{ TUT.flags.issued=false; },until:()=>TUT.flags.issued},
    {npc:'lawful',text:'再來是陷阱題：這台機車戴好安全帽、只載一個人，是守法的。攔到守法民眾會扣 200 分、記一次警告，所以不要攔他。',btn:'放他過去',leave:()=>{ if(TUT.npc) TUT.npc.hold=null; }},
    {npc:'redline',allow:'select',text:'停著的車也能開單。這台停在紅線上，點它鎖定。',until:()=>S.sel===TUT.npc},
    {el:'btnWhistle',allow:'shoot',text:'一樣按「開槍攔停」。車主不在現場，會直接逕行舉發。',until:()=>S.mode==='PDA'},
    {el:'v_PARK_C',label:true,allow:'check',text:'紅線停車屬於「第56條 違規停車」，勾它。',until:()=>{ const c=$('v_PARK_C'); return c&&c.checked; }},
    {el:'pdaIssue',allow:'issue',text:'開單！拖吊車會把違停車拖走。',enter:()=>{ TUT.flags.issued=false; },until:()=>TUT.flags.issued},
    {el:'btnZoom',text:'看不清楚遠處的安全帽或載了什麼，就按「望遠」放大。',btn:'下一步'},
    {el:'btnSupport',text:'考績達 250 分可以「請求支援」，同仁會在對面路口幫你抓 30 秒。',btn:'下一步'},
    {text:'最後幾個狀況，遇到再處理就好：\n・有人拒捕 → 開警車追，點畫面射輪胎\n・警鈴響 → 大樓有小偷，點他射網\n・危險駕駛沒攔到 → 可能出車禍，點紅色三角形去處理\n・攔錯人 → 可以順勢酒測補救\n\n剛上班車少，越接近中午人越多。加油！',btn:'開始正式執勤！',end:true},
  ];
  const tutStep=()=>TSTEPS[TUT.i]||{};
  function startTutorial(){
    G.audio.init(); endSupport(); closeDlg(); $('accModal').hidden=true; ACC.cur=null;
    Object.assign(S,FRESH(),{mode:'PATROL'}); W.reset(); N.density=0.08; N.init(); G.thief.reset();
    resetLook(); look.zoom=false; $('btnZoom').classList.remove('on');
    $('startScreen').hidden=true; $('tutScreen').hidden=true; $('endScreen').hidden=true; $('hud').hidden=false; $('hint').hidden=true;
    bubbles.splice(0).forEach(b=>b.el.remove());
    TUT.on=true; TUT.i=-1; $('coach').hidden=false; hud(); nextStep();
  }
  function nextStep(){
    const cur=tutStep(); if(cur.leave) cur.leave();
    TUT.i++; const st=tutStep(); TUT.npc=null;
    if(!st.text){ endTutorial(); startGame(); return; }
    if(st.enter) st.enter();
    $('coachText').textContent=st.text; $('coachNext').hidden=!st.btn; $('coachNext').textContent=st.btn||'';
    $('coachStep').textContent=`${TUT.i+1} / ${TSTEPS.length}`;
    G.audio.click();
  }
  function endTutorial(){ if(!TUT.on) return; TUT.on=false; $('coach').hidden=true; try{ localStorage.setItem('tcop_tut','1'); }catch(e){} }
  function rectOf(st){
    if(st.el==='@chips'){ const cs=[...document.querySelectorAll('#hud .chip')]; if(!cs.length) return null; const r=cs.map(c=>c.getBoundingClientRect()); return {l:Math.min(...r.map(a=>a.left)),t:Math.min(...r.map(a=>a.top)),r:Math.max(...r.map(a=>a.right)),b:Math.max(...r.map(a=>a.bottom))}; }
    if(st.el){ let e=$(st.el); if(!e) return null; if(st.label) e=e.closest('label')||e; const r=e.getBoundingClientRect(); if(!r.width) return null; return {l:r.left,t:r.top,r:r.right,b:r.bottom}; }
    if(st.npc){ const o=TUT.npc; if(!o||o.dead) return null; const p=project(o.pos,o.kind==='parked'?0.8:1.1); if(p.z>1) return null; const d=cam.position.distanceTo(o.pos), h=Math.max(70,Math.min(200,(o.kind==='parked'?240:170)*30/d)); return {l:p.x-h*0.7,t:p.y-h*0.6,r:p.x+h*0.7,b:p.y+h*0.6}; }
    if(st.world){ const p=project(st.world,0); if(p.z>1) return null; return {l:p.x-st.r,t:p.y-st.r,r:p.x+st.r,b:p.y+st.r}; }
    return null;
  }
  function updCoach(){
    const st=tutStep(); if(!st.text) return;
    if(st.npc&&!TUT.npc){ TUT.npc=N.spawnTut(st.npc); if(TUT.npc&&st.npc!=='lawful'&&st.npc!=='redline'){} }
    if(st.until&&st.until()){ nextStep(); return; }
    const pad=8, r0=rectOf(st), ring=$('coachRing'), blk=$('coachBlock'), msg=$('coachMsg');
    if(st.free){ ring.hidden=true; blk.hidden=true; }
    else {
      blk.hidden=false; blk.classList.toggle('dim',!r0);
      if(r0){ const r={l:r0.l-pad,t:r0.t-pad,r:r0.r+pad,b:r0.b+pad};
        ring.hidden=false; Object.assign(ring.style,{left:r.l+'px',top:r.t+'px',width:(r.r-r.l)+'px',height:(r.b-r.t)+'px'});
        blk.style.clipPath=st.allow?`polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${r.l}px ${r.t}px,${r.r}px ${r.t}px,${r.r}px ${r.b}px,${r.l}px ${r.b}px,${r.l}px ${r.t}px)`:'none';
      } else { ring.hidden=true; blk.style.clipPath='none'; }
    }
    // 對話框位置：放在框框的上方或下方
    const mw=msg.offsetWidth, mh=msg.offsetHeight, W0=innerWidth, H0=innerHeight;
    let x=(W0-mw)/2, y=st.free?70:(H0-mh)/2;
    if(r0&&!st.free){ const cx=(r0.l+r0.r)/2; x=Math.max(12,Math.min(W0-mw-12,cx-mw/2)); y=(r0.b+r0.t)/2<H0*0.5?r0.b+22:r0.t-mh-22; y=Math.max(12,Math.min(H0-mh-12,y)); }
    msg.style.left=x+'px'; msg.style.top=y+'px';
  }

  // ---------- 成就徽章 ----------
  const PEDV=['JAYWALK','ROADWALK','PEDRED'];
  const BADGES=[
    {id:'team',  ch:'援', name:'團隊合作',   desc:'支援同仁幫你開 5 張單',   ok:()=>S.supTickets>=5},
    {id:'acc',   ch:'禍', name:'車禍處理專家',desc:'處理 2 起車禍',           ok:()=>S.accDone>=2},
    {id:'clean', ch:'正', name:'零客訴',     desc:'開 5 張以上且沒誤抓',     ok:()=>S.tickets>=5&&S.wrong===0},
    {id:'chase1',ch:'追', name:'飛車追緝',   desc:'逮捕 1 名逃逸者',         ok:()=>S.chase>=1},
    {id:'thief', ch:'網', name:'飛簷走壁剋星',desc:'用網槍抓到大樓小偷',     ok:()=>S.thieves>=1},
    {id:'nodmg', ch:'盾', name:'毫髮無傷',   desc:'追緝時警車零損傷',        ok:()=>S.cleanChase>=1},
    {id:'helmet',ch:'帽', name:'安全帽糾察隊',desc:'開出 3 張安全帽罰單',     ok:()=>(S.vCount.NOHELMET||0)>=3},
    {id:'tow',   ch:'吊', name:'紅線剋星',   desc:'拖吊 2 輛違停車',         ok:()=>S.towed>=2},
    {id:'ped',   ch:'斑', name:'斑馬線守護者',desc:'開出 3 張行人罰單',       ok:()=>PEDV.reduce((s,k)=>s+(S.vCount[k]||0),0)>=3},
    {id:'dui',   ch:'酒', name:'酒測神手',   desc:'順勢酒測抓到酒駕',        ok:()=>S.dui>=1},
    {id:'sharp', ch:'槍', name:'彈無虛發',   desc:'追緝時每一槍都命中',      ok:()=>S.sharp>=1},
    {id:'roast', ch:'嗆', name:'爆料公社常客',desc:'誤抓民眾 2 次',           ok:()=>S.wrong>=2},
  ];
  function renderBadges(){
    let seen={}; try{ seen=JSON.parse(localStorage.getItem('tcop_badges')||'{}')||{}; }catch(e){}
    const box=$('badges'); box.innerHTML=''; let n=0;
    BADGES.forEach(b=>{
      const got=b.ok(); if(got) n++;
      const d=document.createElement('div'); d.className='medal'+(got?' got':'');
      d.innerHTML=`<i>${b.ch}</i><b>${b.name}</b><small>${b.desc}</small>`+(got&&!seen[b.id]?'<em>NEW</em>':'');
      box.appendChild(d); if(got) seen[b.id]=1;
    });
    $('badgeCount').textContent=`${n} / ${BADGES.length}`;
    try{ localStorage.setItem('tcop_badges',JSON.stringify(seen)); }catch(e){}
  }

  // ---------- 輸入（固定視角，只做點選） ----------
  const el=renderer.domElement; let down=null;
  el.addEventListener('pointerdown',e=>{
    if(S.mode==='CHASE'){ C.fire({x:e.clientX/innerWidth*2-1,y:-(e.clientY/innerHeight)*2+1}); return; }
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    down={x:e.clientX,y:e.clientY,lx:e.clientX,ly:e.clientY,t:performance.now(),drag:false};
  });
  el.addEventListener('pointermove',e=>{
    if(!down||S.mode!=='PATROL') return;
    if(!down.drag&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>12) down.drag=true;
    if(down.drag){ const k=0.0052*cam.fov/56; look.yaw-=(e.clientX-down.lx)*k; }
    down.lx=e.clientX; down.ly=e.clientY;
  });
  el.addEventListener('pointerup',e=>{ if(down&&!down.drag&&performance.now()-down.t<700) tap(e.clientX,e.clientY); down=null; });
  el.addEventListener('pointercancel',()=>{ down=null; });
  el.addEventListener('wheel',e=>{ e.preventDefault(); if(S.mode==='PATROL'){ look.zoom=e.deltaY<0; $('btnZoom').classList.toggle('on',look.zoom); } },{passive:false});
  const held=new Set(); addEventListener('keyup',e=>held.delete(e.key.toLowerCase()));
  el.addEventListener('contextmenu',e=>e.preventDefault());
  addEventListener('keydown',e=>{
    if(S.mode==='CHASE'){
      if(['ArrowLeft','a','A'].includes(e.key)) C.left();
      else if(['ArrowRight','d','D'].includes(e.key)) C.right();
      else if(['s','S','ArrowDown'].includes(e.key)) C.siren();
      else if(['w','W','ArrowUp','Shift'].includes(e.key)) C.boost();
      else if([' ','e','E','Enter','f','F'].includes(e.key)){ e.preventDefault(); C.fire(); }
      return;
    }
    if(S.mode==='PATROL'){
      if(e.key===' '){ e.preventDefault(); whistle(); }
      else if(e.key==='Escape') select(null);
      else if(e.key==='z'||e.key==='Z') toggleZoom();
    else if(e.key==='q'||e.key==='Q') callSupport();
      else if(e.key==='r'||e.key==='R') resetLook();
      else held.add(e.key.toLowerCase());
    } else if(S.mode==='PDA'&&e.key==='Enter') issue();
  });

  // ---------- 特寫鏡頭 ----------
  const pipCam=new THREE.PerspectiveCamera(36,4/3,0.3,200);
  function renderPip(){
    const o=S.sel, pip=$('pip'); if(!o||pip.hidden) return;
    const r=pip.getBoundingClientRect(); if(r.width<10) return;
    const ry=o.group.rotation.y, fx=Math.sin(ry), fz=Math.cos(ry); let sx=fz, sz=-fx;
    if((cam.position.x-o.pos.x)*sx+(cam.position.z-o.pos.z)*sz<0){ sx=-sx; sz=-sz; }
    const d=o.kind==='ped'?4.2:o.kind==='moto'?5.4:9, h=o.kind==='ped'?2.0:o.kind==='moto'?2.6:3.4;
    pipCam.position.set(o.pos.x+sx*d+fx*d*0.3,h,o.pos.z+sz*d+fz*d*0.3);
    pipCam.lookAt(o.pos.x,o.kind==='ped'?1.1:o.kind==='moto'?1.3:0.9,o.pos.z);
    pipCam.aspect=r.width/r.height; pipCam.updateProjectionMatrix();
    const y=innerHeight-r.bottom;
    renderer.setScissorTest(true); renderer.setScissor(r.left,y,r.width,r.height); renderer.setViewport(r.left,y,r.width,r.height);
    renderer.render(W.scene,pipCam);
    renderer.setScissorTest(false); renderer.setViewport(0,0,innerWidth,innerHeight);
  }

  $('coachNext').onclick=()=>nextStep(); $('coachSkip').onclick=()=>{ endTutorial(); startGame(); };
  $('btnStart').onclick=startGame; $('btnManual').onclick=()=>{ $('startScreen').hidden=true; $('tutScreen').hidden=false; $('tutScreen').scrollTop=0; G.audio.init(); G.audio.click(); };
  $('btnTut').onclick=startTutorial;
  $('btnTutStart').onclick=()=>{ $('tutScreen').hidden=true; startGame(); }; $('btnTutBack').onclick=()=>{ $('tutScreen').hidden=true; $('startScreen').hidden=false; }; $('btnAgain').onclick=startGame;
  $('btnWhistle').onclick=whistle; $('btnCancel').onclick=()=>select(null);
  $('pdaIssue').onclick=issue; $('pdaWarn').onclick=warnOnly;
  $('btnSupport').onclick=callSupport;
  N.ev.say=(o,t)=>{ if(S.mode==='PATROL'&&bubbles.length<6) bubble(o,t); };
  $('btnZoom').onclick=toggleZoom; $('btnLook').onclick=()=>{ resetLook(); G.audio.click(); };
  $('btnMute').onclick=()=>{ const m=G.audio.toggle(); $('btnMute').textContent=m?'靜音':'音效'; };
  $('btnPause').onclick=()=>{ if(S.mode==='PATROL'){ S.mode='PAUSE'; $('pauseScreen').hidden=false; } };
  $('btnResume').onclick=()=>{ S.mode='PATROL'; $('pauseScreen').hidden=true; };
  const hold=(id,fn)=>$(id).addEventListener('pointerdown',e=>{ e.preventDefault(); fn(); });
  hold('btnL',()=>C.left()); hold('btnR',()=>C.right()); hold('btnSiren',()=>C.siren()); hold('btnBoost',()=>C.boost()); hold('btnFire',()=>C.fire());

  // 提示輪播
  const HINTS=['考績 250 以上可以按「請求支援」叫同仁來幫忙','左右拖曳畫面可以轉頭','鎖定後再點一次目標就直接開槍攔停','點一下用路人來鎖定檢查','看不清楚就按「望遠」放大','右轉車要停下來讓斑馬線上的行人','紅燈不能右轉，看清楚燈號再開單','路口相機閃光＝有人闖紅燈','合格安全帽＋兩人共乘是合法的','打雙黃燈不代表違規，要看停在哪','紅線停車、停車格外併排都能開單','滑手機走在人行道上不算違規'];
  let hintI=0; setInterval(()=>{ hintI=(hintI+1)%HINTS.length; $('hint').textContent=HINTS[hintI]; },6000);

  // ---------- 主迴圈 ----------
  let last=performance.now();
  N.init();
  function frame(now){
    const dt=Math.min(0.05,(now-last)/1000); last=now;
    if(S.mode==='CHASE'){ C.update(dt); chaseHud(); renderer.render(C.scene,C.cam); requestAnimationFrame(frame); return; }
    if(S.mode==='PATROL'||S.mode==='ACC'||S.mode==='START'||S.mode==='END'){
      W.update(dt); N.update(dt);
    }
    updFx(dt);
    if(S.mode==='PATROL'&&!TUT.on) updSupport(dt);
    if(S.mode==='PATROL'){ vcam.fov=56; vcam.aspect=cam.aspect; vcam.updateProjectionMatrix(); vcam.position.copy(EYE); vcam.lookAt(EYE.x+Math.sin(YAW0),EYE.y+Math.sin(look.pitch),EYE.z+Math.cos(YAW0)); vcam.updateMatrixWorld();
      if(!TUT.on) G.thief.update(dt,cam.position,vcam); updThief(); keyLook(dt); }
    if(TUT.on) updCoach();
    if(S.mode==='PATROL'&&!TUT.on){ const d0=N.density; N.density=0.3+0.7*Math.min(1,S.time/(SHIFT*0.85)); if(d0<0.65&&N.density>=0.65) toast('快中午了，車流和人潮變多了！'); if(d0<0.9&&N.density>=0.9) toast('午餐尖峰！路口大塞車','bad'); }
    if(S.mode==='PATROL'||S.mode==='ACC') updAcc(dt);
    if((S.mode==='PATROL'||S.mode==='ACC')&&!TUT.on){ S.time+=dt; if(S.time>=SHIFT){ S.time=SHIFT; hud(); endGame(false); } else if(Math.floor(S.time*4)!==Math.floor((S.time-dt)*4)) hud(); }
    placeCam();
    // 掃描框
    if(S.sel){
      if(!selectable(S.sel)) select(null);
      else { const p=project(S.sel.pos,S.sel.kind==='ped'?1:0.9); const d=cam.position.distanceTo(S.sel.pos); const sz=Math.max(46,Math.min(180,(S.sel.kind==='ped'?150:S.sel.kind==='moto'?190:260)*30/d));
        const sc=$('scan'); sc.style.left=p.x+'px'; sc.style.top=p.y+'px'; sc.style.width=sz+'px'; sc.style.height=sz*(S.sel.kind==='ped'?1.3:0.8)+'px'; }
    }
    for(const b of bubbles.slice()){
      if(S.mode==='PATROL'||S.mode==='PDA') b.t-=dt;
      const src=b.npc.dead?b.pos:b.npc.pos; const p=project(src,2.6);
      b.el.style.left=p.x+'px'; b.el.style.top=p.y+'px'; b.el.hidden=p.z>1||S.mode==='CHASE';
      if(b.t<=0){ b.el.remove(); bubbles.splice(bubbles.indexOf(b),1); }
    }
    renderer.render(W.scene,cam);
    if(S.mode==='PATROL') renderPip();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
