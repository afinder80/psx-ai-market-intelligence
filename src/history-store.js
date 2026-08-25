const HISTORY_KEY='psxPrivateHistoryV1';
const MAX_SESSIONS=60;

function safeParse(raw,fallback){try{return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
function isoDate(v){const s=String(v||'');const m=s.match(/(20\d{2})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:null;}
function compactStock(s){return {
  symbol:String(s.symbol||'').trim().toUpperCase(),
  price:s.price??null,
  open:s.open??null,
  high:s.high??s.dayHigh??null,
  low:s.low??s.dayLow??null,
  previousClose:s.previousClose??s.ldcp??null,
  volume:s.volume??null,
  change:s.change??null
};}

export function getHistory(){return safeParse(localStorage.getItem(HISTORY_KEY),{sessions:[]});}

export function saveSnapshotToHistory(snapshot){
  if(!snapshot||!Array.isArray(snapshot.stocks)||!snapshot.stocks.length)return getHistory();
  const date=isoDate(snapshot.meta?.latestTradingSession||snapshot.meta?.asOf);
  if(!date)return getHistory();
  const history=getHistory();
  const session={date,asOf:snapshot.meta?.asOf||date,source:snapshot.meta?.source||'Private PSX snapshot',stocks:snapshot.stocks.map(compactStock).filter(s=>s.symbol)};
  const sessions=(history.sessions||[]).filter(s=>s.date!==date);
  sessions.push(session);
  sessions.sort((a,b)=>a.date.localeCompare(b.date));
  history.sessions=sessions.slice(-MAX_SESSIONS);
  localStorage.setItem(HISTORY_KEY,JSON.stringify(history));
  return history;
}

export function clearHistory(){localStorage.removeItem(HISTORY_KEY);}

export function historyStatsBySymbol(history=getHistory()){
  const out=new Map();
  const sessions=Array.isArray(history?.sessions)?history.sessions:[];
  for(const session of sessions){
    for(const s of (session.stocks||[])){
      const symbol=String(s.symbol||'').toUpperCase();if(!symbol)continue;
      if(!out.has(symbol))out.set(symbol,{symbol,dates:[],volumes:[],lows:[],highs:[],closes:[]});
      const r=out.get(symbol);r.dates.push(session.date);
      if(Number.isFinite(Number(s.volume)))r.volumes.push(Number(s.volume));
      const lo=Number(s.low),hi=Number(s.high),cl=Number(s.price);
      if(Number.isFinite(lo))r.lows.push(lo);
      if(Number.isFinite(hi))r.highs.push(hi);
      if(Number.isFinite(cl))r.closes.push(cl);
    }
  }
  for(const r of out.values()){
    const vols=r.volumes.slice(-30);
    r.avgVol30=vols.length?vols.reduce((a,b)=>a+b,0)/vols.length:null;
    r.avgVolSessions=vols.length;
    r.availableLow=r.lows.length?Math.min(...r.lows):null;
    r.availableHigh=r.highs.length?Math.max(...r.highs):null;
    r.sessionCount=r.dates.length;
    r.firstDate=r.dates[0]||null;
    r.lastDate=r.dates[r.dates.length-1]||null;
  }
  return out;
}

export function historySummary(history=getHistory()){
  const sessions=Array.isArray(history?.sessions)?history.sessions:[];
  return {count:sessions.length,first:sessions[0]?.date||null,last:sessions[sessions.length-1]?.date||null};
}
