let db;
const $ = id => document.getElementById(id);
const f = n => n == null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
const histLow = s => s.lowestValue ?? null;
const histHigh = s => s.highestValue ?? null;
const histPos = s => {
  const lo = histLow(s), hi = histHigh(s);
  return lo == null || hi == null || hi <= lo ? null : Math.max(0,Math.min(100,(s.price-lo)/(hi-lo)*100));
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

    const nextDb = await response.json();
    db = nextDb;
    hydrate();
    render();

    const sourceStamp = db.meta.lastSuccessfulRefresh || 'unknown';
    const checkedAt = new Date().toLocaleTimeString();
    const isLive = db.meta.authorizedFeedConnected === true;
    const changed = previousSourceRefresh && previousSourceRefresh !== sourceStamp;

    if(manual){
      $('dataset').textContent = changed
        ? `${db.meta.dataset} · New snapshot loaded · checked ${checkedAt}`
        : `${db.meta.dataset} · ${isLive ? 'Feed checked' : 'Latest published snapshot reloaded'} · checked ${checkedAt}`;
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
    ['Scanned',db.stocks.length,null]
  ].map(x=>`<div class=card><small>${x[0]}</small><div class=value>${f(x[1])}</div>${x[2]!=null?`<div class=${x[2]>=0?'pos':'neg'}>${x[2]>=0?'+':''}${x[2]}%</div>`:''}</div>`).join('');

  $('sector').innerHTML='<option value="">All sectors</option>'+[...new Set(db.stocks.map(s=>s.sector))].sort().map(x=>`<option>${x}</option>`).join('');
  $('state').innerHTML='<option value="">All states</option>'+[...new Set(db.stocks.map(s=>s.state))].sort().map(x=>`<option>${x}</option>`).join('');
  $('statusgrid').innerHTML=`<p>Model: <b>${db.meta.modelVersion}</b></p><p>UI: <b>${db.meta.uiVersion}</b></p><p>Authorized feed: <b>${db.meta.authorizedFeedConnected?'Connected':'Not connected'}</b></p><p>Last source refresh: <b>${db.meta.lastSuccessfulRefresh}</b></p><p>Historical range: <b>${db.meta.historicalRangeStatus||'Verified lifetime values where available'}</b></p><p>Refresh behavior: <b>${db.meta.authorizedFeedConnected?'Requests latest feed-backed dataset':'Reloads latest published GitHub snapshot'}</b></p>`;
}

function rows(){
  const q=$('q').value.toLowerCase(),sec=$('sector').value,pr=$('price').value,st=$('state').value;
  return db.stocks.filter(s=>(!q||(s.symbol+' '+s.company).toLowerCase().includes(q))&&(!sec||s.sector===sec)&&(!st||s.state===st)&&(!$('pe').checked||(s.pe!=null&&s.pe<=10))&&(!pr||(pr==='50'&&s.price<=50)||(pr==='10'&&s.price<10)||(pr==='100+'&&s.price>100))).sort((a,b)=>b.tactical-a.tactical);
}

function render(){
  const r=rows();
  $('count').textContent=r.length+' shares shown';
  document.querySelector('tbody').innerHTML=r.map(s=>`<tr><td><b>${s.symbol}</b></td><td>${s.company}</td><td>${s.sector}</td><td>${f(s.price)}</td><td class=${s.change>=0?'pos':'neg'}>${s.change>=0?'+':''}${s.change}%</td><td title="${s.historicalSource||'Historical value not yet verified'}">${f(histLow(s))}</td><td title="${s.historicalSource||'Historical value not yet verified'}">${f(histHigh(s))}</td><td>${histPos(s)==null?'—':f(histPos(s))+'%'}</td><td>${f(s.pe)}</td><td>${f(s.avgVol)}</td><td>${s.tactical}</td><td>${s.medium}</td><td>${s.long}</td><td>${s.entryQuality}</td><td>${s.confidence}%</td><td><span class=pill>${s.state}</span></td><td><span class=pill>${s.risk}</span></td></tr>`).join('');

  const sm=db.stocks.filter(s=>s.price<=50).sort((a,b)=>b.tactical-a.tactical);
  $('smallgrid').innerHTML=sm.map((s,i)=>`<div><small>#${i+1} · ${s.sector}</small><h3>${s.symbol} · Rs ${f(s.price)}</h3><p class=${s.change>=0?'pos':'neg'}>${s.change>=0?'+':''}${s.change}%</p><p>Lifetime range <b>${f(histLow(s))} – ${f(histHigh(s))}</b></p><p>Tactical <b>${s.tactical}</b> · Entry Q <b>${s.entryQuality}</b></p><span class=pill>${s.state}</span></div>`).join('');
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