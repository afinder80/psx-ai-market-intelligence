let db;
const $ = id => document.getElementById(id);
const f = n => n == null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const pct = n => n == null ? '—' : `${Number(n)>=0?'+':''}${f(n)}%`;
const score = n => n == null ? '—' : f(n);
const histLow = s => s.lowestValue ?? null;
const histHigh = s => s.highestValue ?? null;
const histPos = s => {
  const lo = histLow(s), hi = histHigh(s);
  return lo == null || hi == null || hi <= lo || s.price == null ? null : Math.max(0,Math.min(100,(s.price-lo)/(hi-lo)*100));
};

async function load({manual=false}={}){
  const b = $('refresh');
  const previousSourceRefresh = db?.meta?.lastSuccessfulRefresh ?? null;
  b.disabled = true;
  b.textContent = manual ? 'Refreshing…' : 'Loading…';
  $('dataset').textContent = manual ? 'Checking for the latest published dataset…' : 'Loading market dataset…';

  try {
    const response = await fetch(`data/market.json?ts=${Date.now()}`,{
      cache:'no-store',
      headers:{'Cache-Control':'no-cache'}
    });
    if(!response.ok) throw new Error(`Dataset request failed (${response.status})`);

    db = await response.json();
    hydrate();
    render();

    const sourceStamp = db.meta.lastSuccessfulRefresh || 'unknown';
    const checkedAt = new Date().toLocaleTimeString();
    const isLive = db.meta.authorizedFeedConnected === true;
    const changed = previousSourceRefresh && previousSourceRefresh !== sourceStamp;

    if(manual){
      $('dataset').textContent = changed
        ? `${db.meta.dataset} · New snapshot loaded · checked ${checkedAt}`
        : `${db.meta.dataset} · ${isLive ? 'Feed-backed snapshot checked' : 'Latest published snapshot reloaded'} · checked ${checkedAt}`;
    } else {
      $('dataset').textContent = db.meta.dataset;
    }
  } catch(err){
    console.error(err);
    $('dataset').textContent = `Refresh failed: ${err.message}`;
  } finally {
    b.disabled = false;
    b.textContent = db?.meta?.authorizedFeedConnected ? 'Refresh Data' : 'Reload Snapshot';
  }
}

function hydrate(){
  const m=db.market;
  $('cards').innerHTML=[
    ['KSE-100',m.kse100,m.kse100Change],
    ['All Share',m.allShare,m.allShareChange],
    ['OGTI',m.ogti,m.ogtiChange],
    ['Universe',db.stocks.length,null]
  ].map(x=>`<div class=card><small>${x[0]}</small><div class=value>${f(x[1])}</div>${x[2]!=null?`<div class=${x[2]>=0?'pos':'neg'}>${pct(x[2])}</div>`:''}</div>`).join('');

  $('sector').innerHTML='<option value="">All sectors</option>'+[...new Set(db.stocks.map(s=>s.sector||'Unclassified'))].sort().map(x=>`<option>${x}</option>`).join('');
  $('state').innerHTML='<option value="">All states</option>'+[...new Set(db.stocks.map(s=>s.state||'UNSCORED'))].sort().map(x=>`<option>${x}</option>`).join('');
  const provider = db.meta.dataProvider || (db.meta.authorizedFeedConnected ? 'Authorized market-data feed' : 'Static published snapshot');
  const ingested = db.meta.lastIngestedAt || '—';
  const universeSize = db.meta.universeSize || db.stocks.length;
  $('statusgrid').innerHTML=`<p>Model: <b>${db.meta.modelVersion}</b></p><p>UI: <b>${db.meta.uiVersion}</b></p><p>Authorized feed: <b>${db.meta.authorizedFeedConnected?'Connected':'Not connected'}</b></p><p>Provider: <b>${provider}</b></p><p>Universe size: <b>${universeSize}</b></p><p>Last source refresh: <b>${db.meta.lastSuccessfulRefresh}</b></p><p>Last ingest: <b>${ingested}</b></p><p>Historical range: <b>${db.meta.historicalRangeStatus||'Verified lifetime values where available'}</b></p><p>Refresh behavior: <b>${db.meta.authorizedFeedConnected?'Requests latest feed-backed published dataset':'Reloads latest published GitHub snapshot'}</b></p>`;
}

function rows(){
  const q=$('q').value.toLowerCase(),sec=$('sector').value,pr=$('price').value,st=$('state').value;
  return db.stocks.filter(s=>{
    const price=s.price;
    return (!q||((s.symbol||'')+' '+(s.company||'')).toLowerCase().includes(q))&&
      (!sec||(s.sector||'Unclassified')===sec)&&
      (!st||(s.state||'UNSCORED')===st)&&
      (!$('pe').checked||(s.pe!=null&&s.pe<=10))&&
      (!pr||(price!=null&&((pr==='50'&&price<=50)||(pr==='10'&&price<10)||(pr==='100+'&&price>100))));
  }).sort((a,b)=>(b.tactical??0)-(a.tactical??0)||String(a.symbol).localeCompare(String(b.symbol)));
}

function render(){
  const r=rows();
  $('count').textContent=`${r.length} of ${db.stocks.length} shares shown`;
  document.querySelector('tbody').innerHTML=r.map(s=>`<tr><td><b>${s.symbol}</b></td><td>${s.company||'—'}</td><td>${s.sector||'Unclassified'}</td><td>${f(s.price)}</td><td class=${s.change==null?'':s.change>=0?'pos':'neg'}>${pct(s.change)}</td><td title="${s.historicalSource||'Historical value not yet verified'}">${f(histLow(s))}</td><td title="${s.historicalSource||'Historical value not yet verified'}">${f(histHigh(s))}</td><td>${histPos(s)==null?'—':f(histPos(s))+'%'}</td><td>${f(s.pe)}</td><td>${f(s.avgVol)}</td><td>${score(s.tactical)}</td><td>${score(s.medium)}</td><td>${score(s.long)}</td><td>${score(s.entryQuality)}</td><td>${s.confidence==null?'—':f(s.confidence)+'%'}</td><td><span class=pill>${s.state||'UNSCORED'}</span></td><td><span class=pill>${s.risk||'DATA ONLY'}</span></td></tr>`).join('');

  const sm=db.stocks.filter(s=>s.price!=null&&s.price<=50).sort((a,b)=>(b.tactical??0)-(a.tactical??0));
  $('smallgrid').innerHTML=sm.map((s,i)=>`<div><small>#${i+1} · ${s.sector||'Unclassified'}</small><h3>${s.symbol} · Rs ${f(s.price)}</h3><p class=${s.change==null?'':s.change>=0?'pos':'neg'}>${pct(s.change)}</p><p>Lifetime range <b>${f(histLow(s))} – ${f(histHigh(s))}</b></p><p>Tactical <b>${score(s.tactical)}</b> · Entry Q <b>${score(s.entryQuality)}</b></p><span class=pill>${s.state||'UNSCORED'}</span></div>`).join('');
}

['q','sector','price','state','pe'].forEach(id=>$(id).addEventListener(id==='q'?'input':'change',render));
$('refresh').addEventListener('click',()=>load({manual:true}));
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.add('hidden'));
  $(b.dataset.view).classList.remove('hidden');
}));
load();
