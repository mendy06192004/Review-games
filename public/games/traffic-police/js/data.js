window.G = window.G || {};

// 違規資料庫（罰鍰為遊戲數值）
G.VIOL = {
  NOHELMET:  { t:'moto', title:'未依規定戴安全帽',        fine:500,  esc:0.12 },
  OVERLOAD:  { t:'moto', title:'機車附載人員超過規定（三貼）', fine:600,  esc:0.18 },
  CARGO:     { t:'moto', title:'機車載運物品超長超寬',      fine:600,  esc:0.22 },
  SIDEWALK:  { t:'moto', title:'在人行道／騎樓騎乘機車',    fine:1200, esc:0.30 },
  REDLIGHT_M:{ t:'moto', title:'機車闖紅燈',              fine:2700, esc:0.40 },
  STAND:     { t:'moto', title:'站立騎乘（危險駕駛）',       fine:1800, esc:0.25 },
  PHONE_M:   { t:'moto', title:'騎車使用手機',              fine:1000, esc:0.1 },
  UMBRELLA:  { t:'moto', title:'騎車撐傘',                 fine:600,  esc:0.05 },
  PET:       { t:'moto', title:'騎車牽寵物',               fine:600,  esc:0.1 },
  ZIGZAG_M:  { t:'moto', title:'蛇行',                     fine:0,    esc:0.3 },
  CROSSPARK: { t:'moto', title:'機車停在斑馬線上',           fine:0,    esc:0 },
  FAKE_M:    { t:'moto', title:'騎車時唱歌太難聽',          fine:0,    esc:0 },
  REDLIGHT_C:{ t:'car',  title:'汽車闖紅燈',              fine:2700, esc:0.40 },
  RIGHT_RED: { t:'car',  title:'紅燈右轉',                fine:1800, esc:0.25 },
  NOYIELD:   { t:'car',  title:'轉彎未暫停讓行人',          fine:3600, esc:0.2 },
  REDLINE:   { t:'car',  title:'紅線違規停車',             fine:900,  esc:0 },
  DOUBLE:    { t:'car',  title:'併排停車',                fine:1200, esc:0.15 },
  ZIGZAG_C:  { t:'car',  title:'蛇行',                     fine:0,    esc:0.3 },
  WALKPARK:  { t:'car',  title:'汽車停在人行道上',           fine:0,    esc:0 },
  FAKE_C:    { t:'car',  title:'車子太久沒洗',             fine:0,    esc:0 },
  JAYWALK:   { t:'ped',  title:'未走行人穿越道穿越車道',     fine:500,  esc:0 },
  ROADWALK:  { t:'ped',  title:'在車道上行走逗留',          fine:300,  esc:0 },
  PEDRED:    { t:'ped',  title:'行人不依號誌穿越（闖紅燈）',  fine:500,  esc:0 },
  FAKE_P:    { t:'ped',  title:'穿藍白拖上街',             fine:0,    esc:0 },
};
// 罰單上的違規條款（道路交通管理處罰條例，合併為大類）
// 罰鍰為法定級距（min~max），遊戲以「到案繳納通常適用的最低額」計算
G.CATS = {
  HELMET:  { law:'第31條第6項', title:'未依規定戴安全帽',                    min:500 },
  LOAD:    { law:'第31條第5項', title:'機車附載人員或物品未依規定',            min:300,  max:600 },
  DANGER_M:{ law:'第43條',     title:'危險駕駛（蛇行、站立、撐傘、牽寵物）',    min:6000, max:36000 },
  PHONE:   { law:'第31條之1',  title:'騎車手持行動電話',                    min:1200 },
  SIGNAL_M:{ law:'第53條',     title:'闖紅燈',                            min:1800, max:5400 },
  WALKWAY: { law:'第45條',     title:'在人行道、騎樓行駛',                  min:600,  max:1800 },
  PARK_M:  { law:'第56條',     title:'違規停車（斑馬線、人行道）',            min:600,  max:1200 },
  FAKE_M:  { law:'',          title:'騎車時唱歌太難聽',                    min:0 },
  SIGNAL_C:{ law:'第53條第1項', title:'闖紅燈',                            min:1800, max:5400 },
  RTURN:   { law:'第53條第2項', title:'紅燈右轉',                          min:600,  max:1800 },
  YIELD:   { law:'第44條',     title:'行經行人穿越道未暫停讓行人',            min:1200, max:6000 },
  DANGER_C:{ law:'第43條',     title:'危險駕駛（蛇行）',                    min:6000, max:36000 },
  PARK_C:  { law:'第56條',     title:'違規停車（紅線、人行道、併排）',         min:600,  max:1200 },
  FAKE_C:  { law:'',          title:'車子太久沒洗',                        min:0 },
  PED:     { law:'第78條',     title:'行人不依規定通行（闖紅燈、未走斑馬線、在車道逗留）', min:500 },
  FAKE_P:  { law:'',          title:'穿藍白拖上街',                        min:0 },
  DUI_M:   { law:'第35條',     title:'酒後駕車（機車）',                    min:15000, max:90000 },
  DUI_C:   { law:'第35條',     title:'酒後駕車（汽車）',                    min:30000, max:120000 },
  ESCAPE:  { law:'第60條',     title:'拒絕停車受檢',                        min:10000, max:30000 },
};
for(const k in G.CATS){ const c=G.CATS[k]; c.fine=c.min; c.range=c.min?('NT$'+c.min.toLocaleString()+(c.max?'～'+c.max.toLocaleString():'')):'—'; }

// 行為 → 罰單條款
G.CAT = { NOHELMET:'HELMET', OVERLOAD:'LOAD', CARGO:'LOAD', STAND:'DANGER_M', UMBRELLA:'DANGER_M', PET:'DANGER_M', ZIGZAG_M:'DANGER_M',
  PHONE_M:'PHONE', REDLIGHT_M:'SIGNAL_M', SIDEWALK:'WALKWAY', CROSSPARK:'PARK_M', FAKE_M:'FAKE_M',
  REDLIGHT_C:'SIGNAL_C', RIGHT_RED:'RTURN', NOYIELD:'YIELD', ZIGZAG_C:'DANGER_C', REDLINE:'PARK_C', DOUBLE:'PARK_C', WALKPARK:'PARK_C', FAKE_C:'FAKE_C',
  JAYWALK:'PED', ROADWALK:'PED', PEDRED:'PED', FAKE_P:'FAKE_P' };
G.OPTIONS = {
  moto:['HELMET','LOAD','DANGER_M','PHONE','SIGNAL_M','WALKWAY','PARK_M','FAKE_M'],
  car:['SIGNAL_C','RTURN','YIELD','DANGER_C','PARK_C','FAKE_C'],
  ped:['PED','FAKE_P'],
};
G.cats = o=>[...new Set([...o.actual].map(k=>G.CAT[k]).filter(Boolean))];
G.fineOf = o=>G.cats(o).reduce((s,c)=>s+G.CATS[c].fine,0);
G.catName = c=>G.CATS[c].title.replace(/（.*）/,'');
G.RISKY = ['REDLIGHT_M','REDLIGHT_C','RIGHT_RED','NOYIELD','STAND','PHONE_M','ZIGZAG_M','ZIGZAG_C','UMBRELLA','PET','SIDEWALK'];


G.PLEAS = {
  NOHELMET:['這頂工程帽很硬啦，比安全帽還安全不信你敲敲看！','湯鍋是不鏽鋼的欸，很耐撞！','西瓜皮很防曬耶！','塑膠袋有綁很緊啦！','大同電鍋超耐摔的！','我家就在前面巷子而已啦～'],
  OVERLOAD:['三個人比較省油啊長官！','小朋友很瘦，不算一個人啦！'],
  CARGO:['冰箱是要搬去給我女兒的，很急！','叫貨運要三百塊欸，自己載比較快！','機車壞了啊，我用機車載它去修！','搬家公司太貴了！'],
  ZIGZAG_M:['我在閃坑洞啦！','路太直很無聊…'],
  ZIGZAG_C:['我在測試新輪胎！','方向盤有點鬆啦'],
  CROSSPARK:['（車主不在現場，逕行舉發並拖吊）'],
  WALKPARK:['（車主不在現場，逕行舉發並拖吊）'],
  STAND:['坐太久屁股會痛啦！','這樣比較涼～','我在練平衡感！'],
  PHONE_M:['我在看導航啦！','老婆打來不接會被罵！'],
  UMBRELLA:['太陽很大會曬黑欸！','我怕頭髮亂掉…'],
  PET:['我家狗狗要運動啊！','牠自己要跟的啦～'],
  SIDEWALK:['前面塞車啦，我只是騎上來一下下！','騎樓本來就是給機車走的吧？'],
  REDLIGHT_M:['黃燈啊！我發誓剛剛是黃燈！','長官放過我啦，我阿嬤在醫院等我送便當！'],
  REDLIGHT_C:['是橘燈啦，真的是橘燈！','後面有車在逼我，我不敢停啊！'],
  RIGHT_RED:['國外都可以紅燈右轉啊！','我看沒車就轉了嘛…','右轉不是本來就可以轉嗎？'],
  NOYIELD:['他走很慢啊，我以為我過得去！','我有看到他，我是在讓他啊（沒有停）','我按喇叭提醒他了啊！'],
  REDLINE:['（駕駛不在現場，逕行舉發並拖吊）'],
  DOUBLE:['我不是併排停車，我只是踩著煞車買杯珍奶而已！','我一分鐘就好，雞排快炸好了！'],
  JAYWALK:['斑馬線太遠了啦，要走一百公尺欸！','對面那家早餐店快賣完了！'],
  ROADWALK:['我在抓寶，沒注意到…','人行道被機車停滿了，我只能走這裡啊！'],
  PEDRED:['綠燈太短了我走不完啊！','我看大家都在走我就走了…'],
};
G.VIOL.ESCAPE={ t:'any', title:'拒絕停車受檢逃逸', fine:10000, esc:0 };
G.VIOL.ESCAPE.fine=G.CATS.ESCAPE.min;
G.ESC_PLEAS=['我以為你在跟別人揮手啦！','我耳機開太大聲沒聽到哨子！','我趕著去接小孩放學啦！','我沒有跑，我只是騎比較快！'];
G.SHOUT = {
  NOHELMET:['這是最新款安全帽！','頭好涼～','我有戴啊（電鍋）'], OVERLOAD:['坐穩喔！','擠一下擠一下～'], CARGO:['搬家省錢！','借過借過！','這台超能載！'],
  SIDEWALK:['叭叭！讓一下！','借過！'], ZIGZAG_M:['左～右～左～','好玩！'], ZIGZAG_C:['甩尾～','讓開讓開！'], STAND:['看我站著騎！','好涼爽～'], PHONE_M:['喂？我在騎車啦','等等我回你'],
  UMBRELLA:['雨好大喔～（晴天）','防曬很重要'], PET:['旺旺！','旺！'], REDLIGHT_M:['衝啊！','黃燈啦！'], REDLIGHT_C:['衝啊！','還是黃的！'],
  RIGHT_RED:['沒車啦～','右轉可以吧？'], NOYIELD:['叭叭！借過！','我先啦！'], JAYWALK:['快衝過去！','斑馬線好遠…'], ROADWALK:['抓寶中…','這隻好稀有！'], PEDRED:['還可以走吧？','衝了！'],
};
G.SMALLTALK=['早安～','今天好熱','要遲到了','中午吃什麼？','下雨了嗎？'];
G.COMPLAIN = ['長官我哪裡違規？你還開槍！','我要申訴你！','我要上爆料公社！','我有行車紀錄器喔！','警察亂攔人啊！大家快來看！'];
G.THANKS = ['好啦好啦，下次不敢了…','又要繳錢了…','我要去監理站申訴！','這個月白做了啦！'];

G.rand = (a,b)=>a+Math.random()*(b-a);
G.ri = (a,b)=>Math.floor(G.rand(a,b+1));
G.pick = a=>a[Math.floor(Math.random()*a.length)];
G.chance = p=>Math.random()<p;
G.LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
G.plate = kind=>{
  const L=()=>G.pick(G.LET.split(''));
  if(kind==='moto') return L()+L()+L()+'-'+G.ri(100,999);
  if(kind==='ped') return '身分證 '+L()+G.ri(1,2)+'*****'+G.ri(100,999);
  return L()+L()+L()+'-'+G.ri(1000,9999);
};
