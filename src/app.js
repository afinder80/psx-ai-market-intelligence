import {saveSnapshotToHistory,getHistory,historyStatsBySymbol,historySummary,clearHistory} from './history-store.js';

let db;
let universeMeta={};
let privateMeta=null;
let historyInfo={count:0,first:null,last:null};
const LOCAL_KEY='psxPrivateSnapshotV1';
const $=id=>document.getElementById(id);
const f=n=>n==null||n===''?'—':Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const pct=n=>n==null||n===''?'—':`${Number(n)>=0?'+':''}${f(n)}%`;
const score=n=>n==null?'—':f(n);
const histLow=s=>s.lowestValue??null;
const histHigh=s=>s.highestValue??null;
const histPos=s=>{const lo=histLow(s),hi=histHigh(s);return lo==null||hi==null||hi<=lo||s.price==null?null:Math.max(0,Math.min(100,(s.price-lo)/(hi-lo)*100));};
const dayHigh=s=>s.high??s.dayHigh??null;
const dayLow=s=>s.low??s.dayLow??null;
const prevClose=s=>s.previousClose??s.ldcp??null;
function clone(x){return JSON.parse(JSON.stringify(x));}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

function sanitizePublicMarket(market){
  const out=clone(market);out.meta=out.meta||{};
  if(out.meta.indexDataFresh===false){out.market={...(out.market||{}),kse100:null,kse100Change:null,allShare:null,allShareChange:null,ogti:null,ogtiChange:null};}
  if(out.meta.stockDataFresh===false){out.stocks=(out.stocks||[]).map(s=>({symbol:s.symbol,company:s.company,sector:s.sector,lowestValue:s.lowestValue??null,highestValue:s.highestValue??null,historicalSource:s.historicalSource??null,state:'STALE SNAPSHOT',risk:'DO NOT USE'}));}
  return out;
}

function mergeUniverse(master,market){
  const marketStocks=Array.isArray(market.stocks)?market.stocks:[];
  const masterStocks=Array.isArray(master?.stocks)?master.stocks:[];
  const byMarket=new Map(marketStocks.map(s=>[String(s.symbol||'').toUpperCase(),s]));
  const merged=[];const seen=new Set();const snapshotOnly=[];
  for(const base of masterStocks){
    const symbol=String(base.symbol||'').trim().toUpperCase();if(!symbol)continue;
    const live=byMarket.get(symbol)||{};
    merged.push({state:'UNSCORED',risk:'DATA ONLY',...base,...live,symbol,referenceUniverse:true,company:base.company||live.company||symbol,sector:base.sector||live.sector||'Unclassified'});
    seen.add(symbol);
  }
  for(const live of marketStocks){
    const symbol=String(live.symbol||'').trim().toUpperCase();if(!symbol||seen.has(symbol))continue;
    snapshotOnly.push(symbol);
    merged.push({state:'UNSCORED',risk:'PRIVATE DATA',...live,symbol,referenceUniverse:false,company:live.company||symbol,sector:live.sector||'Unclassified'});
  }
  return {...market,stocks:merged,referenceUniverseSize:masterStocks.length,snapshotOnlySymbols:snapshotOnly};
}

function loadPrivateStored(){try{const raw=localStorage.getItem(LOCAL_KEY);return raw?JSON.parse(raw):null;}catch{return null;}}

function applyPrivateSnapshot(base,stored){
  if(!stored?.snapshot)return base;
  const snap=stored.snapshot;const out=clone(base);
  const by=new Map((out.stocks||[]).map(s=>[String(s.symbol||'').toUpperCase(),s]));
  for(const incoming of (Array.isArray(snap.stocks)?snap.stocks:[])){
    const symbol=String(incoming.symbol||'').trim().toUpperCase();if(!symbol)continue;
    const prior=by.get(symbol)||{symbol};
    by.set(symbol,{...prior,...incoming,symbol,state:incoming.state||'UNSCORED',risk:incoming.risk||'PRIVATE DATA'});
  }
  out.stocks=[...by.values()];
  out.market={...(out.market||{}),...(snap.market||{})};
  out.meta={...(out.meta||{}),privateLocalSnapshot:true,stockDataFresh:Array.isArray(snap.stocks)&&snap.stocks.length>0,indexDataFresh:!!snap.market,dataProvider:'Private browser snapshot',dataset:`Private browser snapshot — ${stored.name||'local file'}`,lastSuccessfulRefresh:snap.meta?.asOf||snap.meta?.lastSuccessfulRefresh||stored.importedAt};
  privateMeta={name:stored.name||'local file',importedAt:stored.importedAt,asOf:snap.meta?.asOf||snap.meta?.lastSuccessfulRefresh||'—',source:snap.meta?.source||'Private file'};
  return out;
}

function applyHistoryAnalytics(market){
  const history=getHistory();historyInfo=historySummary(history);const stats=historyStatsBySymbol(history);
  market.stocks=(market.stocks||[]).map(s=>{
    const h=stats.get(String(s.symbol||'').toUpperCase());
    if(!h)return {...s,historySessions:0,avgVol30:null,localLow:null,localHigh:null};
    return {...s,historySessions:h.sessionCount,avgVol30:h.avgVolSessions>=30?h.avgVol30:null,avgVolProgress:h.avgVolSessions,localLow:h.availableLow,localHigh:h.availableHigh,localHistoryStart:h.firstDate,localHistoryEnd:h.lastDate};
  });
  return market;
}

async function load({manual=false}={}){
  const b=$('refresh');b.disabled=true;b.textContent=manual?'Reloading…':'Loading…';$('dataset').textContent='Loading PSX reference universe…';
  try{
    const ts=Date.now();
    const [mr,ur]=await Promise.all([fetch(`data/market.json?ts=${ts}`,{cache:'no-store'}),fetch(`data/universe.json?ts=${ts}`,{cache:'no-store'})]);
    if(!mr.ok)throw new Error(`Market dataset request failed (${mr.status})`);if(!ur.ok)throw new Error(`Universe dataset request failed (${ur.status})`);
    let market=sanitizePublicMarket(await mr.json());const universe=await ur.json();universeMeta=universe.meta||{};privateMeta=null;
    const stored=loadPrivateStored();if(stored?.snapshot?.stocks?.length)saveSnapshotToHistory(stored.snapshot);
    market=applyPrivateSnapshot(market,stored);db=applyHistoryAnalytics(mergeUniverse(universe,market));
    hydrate();render();
    const checked=new Date().toLocaleTimeString();
    $('dataset').textContent=db.meta.privateLocalSnapshot?`${db.meta.dataset} · private/local only · checked ${checked}`:`Public market snapshot is stale — load a private PSX file before market analysis · checked ${checked}`;
  }catch(err){console.error(err);$('dataset').textContent=`Refresh failed: ${err.message}`;}finally{b.disabled=false;b.textContent='Reload Data';}
}

function hydrate(){
  const m=db.market||{};const universeCount=Number(universeMeta.universeSize)||db.referenceUniverseSize||db.stocks.filter(s=>s.referenceUniverse).length;
  $('cards').innerHTML=[['KSE-100',m.kse100,m.kse100Change],['All Share',m.allShare,m.allShareChange],['OGTI',m.ogti,m.ogtiChange],['Universe',universeCount,null]].map(x=>`<div class=card><small>${x[0]}</small><div class=value>${f(x[1])}</div>${x[2]!=null?`<div class=${x[2]>=0?'pos':'neg'}>${pct(x[2])}</div>`:''}</div>`).join('');
  $('sector').innerHTML='<option value="">All sectors</option>'+[...new Set(db.stocks.map(s=>s.sector||'Unclassified'))].sort().map(x=>`<option>${esc(x)}</option>`).join('');
  $('state').innerHTML='<option value="">All states</option>'+[...new Set(db.stocks.map(s=>s.state||'UNSCORED'))].sort().map(x=>`<option>${esc(x)}</option>`).join('');
  const universeStatus=universeMeta.complete===true?'Complete':'Incomplete';const mode=db.meta.privateLocalSnapshot?'Private browser snapshot':'Public demo only (stale)';
  const priced=db.stocks.filter(s=>s.price!=null).length;const extras=db.snapshotOnlySymbols||[];const ready30=historyInfo.count>=30?'Ready':`${historyInfo.count}/30 sessions collected`;
  $('statusgrid').innerHTML=`<p>Data mode: <b>${mode}</b></p><p>Official universe: <b>${universeCount}</b></p><p>Rows with current close: <b>${priced}</b></p><p>Snapshot-only symbols: <b>${extras.length?esc(extras.join(', ')):'None'}</b></p><p>Universe source: <b>${esc(universeMeta.source||'Reference master')}</b></p><p>Universe as of: <b>${esc(universeMeta.asOf||'—')}</b></p><p>Universe status: <b>${universeStatus}</b></p><p>Market source: <b>${esc(db.meta.dataProvider||'Public demo snapshot')}</b></p><p>Market as of: <b>${esc(db.meta.lastSuccessfulRefresh||'—')}</b></p><p>Private file: <b>${esc(privateMeta?.name||'—')}</b></p><p>History sessions stored: <b>${historyInfo.count}</b></p><p>History date range: <b>${historyInfo.first||'—'} → ${historyInfo.last||'—'}</b></p><p>30-session Avg Volume: <b>${ready30}</b></p><p>Lowest/Highest rule: <b>Lifetime values only when independently verified; local-session range is shown separately</b></p>`;
  $('clearLocal').classList.toggle('hidden',!db.meta.privateLocalSnapshot&&historyInfo.count===0);
}

function rows(){
  const q=$('q').value.toLowerCase(),sec=$('sector').value,pr=$('price').value,st=$('state').value;
  return db.stocks.filter(s=>{const price=s.price;return(!q||((s.symbol||'')+' '+(s.company||'')).toLowerCase().includes(q))&&(!sec||(s.sector||'Unclassified')===sec)&&(!st||(s.state||'UNSCORED')===st)&&(!$('pe').checked||(s.pe!=null&&s.pe<=10))&&(!pr||(price!=null&&((pr==='50'&&price<=50)||(pr==='10'&&price<10)||(pr==='100+'&&price>100))));}).sort((a,b)=>(b.tactical??0)-(a.tactical??0)||String(a.symbol).localeCompare(String(b.symbol)));
}

function localRange(s){if(s.localLow==null&&s.localHigh==null)return '—';return `${f(s.localLow)} – ${f(s.localHigh)}`;}
function avg30Cell(s){if(s.avgVol30!=null)return f(s.avgVol30);const n=s.avgVolProgress||0;return `<span title="30-session average becomes available after 30 stored trading sessions">—${n?` (${n}/30)`:''}</span>`;}

function render(){
  const r=rows();const universeCount=Number(universeMeta.universeSize)||db.referenceUniverseSize||0;const extras=(db.snapshotOnlySymbols||[]).length;
  $('count').textContent=`${r.length} rows shown · ${universeCount} official-universe symbols${extras?` + ${extras} snapshot-only`:''}`;
  document.querySelector('tbody').innerHTML=r.map(s=>`<tr><td><b>${esc(s.symbol)}</b>${s.referenceUniverse===false?' <span title="Present in private closing file but not in current reference universe">*</span>':''}</td><td>${esc(s.company||'—')}</td><td>${esc(s.sector||'Unclassified')}</td><td>${f(s.price)}</td><td class=${s.change==null?'':s.change>=0?'pos':'neg'}>${pct(s.change)}</td><td>${f(s.open)}</td><td>${f(dayHigh(s))}</td><td>${f(dayLow(s))}</td><td>${f(prevClose(s))}</td><td>${f(s.volume)}</td><td>${avg30Cell(s)}</td><td title="${esc(s.historicalSource||'Lifetime value not yet independently verified')}">${f(histLow(s))}</td><td title="${esc(s.historicalSource||'Lifetime value not yet independently verified')}">${f(histHigh(s))}</td><td title="Local browser history: ${esc(s.localHistoryStart||'—')} to ${esc(s.localHistoryEnd||'—')} · ${s.historySessions||0} sessions">${localRange(s)}</td><td>${histPos(s)==null?'—':f(histPos(s))+'%'}</td><td>${f(s.pe)}</td><td>${score(s.tactical)}</td><td>${score(s.medium)}</td><td>${score(s.long)}</td><td>${score(s.entryQuality)}</td><td>${s.confidence==null?'—':f(s.confidence)+'%'}</td><td><span class=pill>${esc(s.state||'UNSCORED')}</span></td><td><span class=pill>${esc(s.risk||'DATA ONLY')}</span></td></tr>`).join('');
  const sm=db.stocks.filter(s=>s.price!=null&&s.price<=50).sort((a,b)=>(b.tactical??0)-(a.tactical??0));
  $('smallgrid').innerHTML=sm.map((s,i)=>`<div><small>#${i+1} · ${esc(s.sector||'Unclassified')}</small><h3>${esc(s.symbol)} · Rs ${f(s.price)}</h3><p class=${s.change==null?'':s.change>=0?'pos':'neg'}>${pct(s.change)}</p><p>Day O/H/L <b>${f(s.open)} / ${f(dayHigh(s))} / ${f(dayLow(s))}</b></p><p>Volume <b>${f(s.volume)}</b> · 30D Avg <b>${s.avgVol30!=null?f(s.avgVol30):`pending ${s.avgVolProgress||0}/30`}</b></p><p>Lifetime range <b>${f(histLow(s))} – ${f(histHigh(s))}</b></p><p>Local range <b>${localRange(s)}</b></p><span class=pill>${esc(s.state||'UNSCORED')}</span></div>`).join('');
}

$('loadLocal').addEventListener('click',()=>$('localFile').click());
$('clearLocal').addEventListener('click',async()=>{if(!confirm('Clear the current private snapshot and all locally accumulated PSX history in this browser?'))return;localStorage.removeItem(LOCAL_KEY);clearHistory();await load({manual:true});});
['q','sector','price','state','pe'].forEach(id=>$(id).addEventListener(id==='q'?'input':'change',render));
$('refresh').addEventListener('click',()=>load({manual:true}));
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));$(b.dataset.view).classList.remove('hidden');}));
load();
