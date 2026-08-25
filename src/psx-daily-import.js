const LOCAL_KEY='psxPrivateSnapshotV1';

const num=v=>{if(v==null||v==='')return null;const x=Number(String(v).replace(/[%,$\s]/g,'').replace(/,/g,''));return Number.isFinite(x)?x:null;};

function splitDelimited(text,delimiter){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c==='"'){
      if(quoted&&n==='"'){cell+='"';i++;}else quoted=!quoted;
    }else if(c===delimiter&&!quoted){row.push(cell.trim());cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  row.push(cell.trim());if(row.some(x=>x!==''))rows.push(row);return rows;
}

function detectDelimiter(text){
  const line=String(text).split(/\r?\n/).find(x=>x.trim())||'';
  const tabs=(line.match(/\t/g)||[]).length, commas=(line.match(/,/g)||[]).length;
  return tabs>commas?'\t':',';
}

const norm=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,' ');
const compact=s=>norm(s).replace(/[^A-Z0-9%]/g,'');

function findHeaderIndex(rawHeaders,tests){
  for(let i=0;i<rawHeaders.length;i++){
    const raw=norm(rawHeaders[i]), key=compact(rawHeaders[i]);
    if(tests.some(t=>t(raw,key))) return i;
  }
  return -1;
}

function inferAsOf(fileName){
  const n=String(fileName||'');
  let m=n.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/);
  if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}T15:50:00+05:00`;
  m=n.match(/(\d{1,2})[-_](\d{1,2})[-_](20\d{2})/);
  if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T15:50:00+05:00`;
  return new Date().toISOString();
}

function parsePsxDaily(text,fileName){
  const rows=splitDelimited(text,detectDelimiter(text));
  if(!rows.length)throw new Error('File is empty');

  let hi=-1,rawHeaders=[];
  for(let i=0;i<Math.min(rows.length,25);i++){
    const keys=rows[i].map(compact);
    if(keys.includes('SYMBOL')&&(keys.includes('CURRENT')||keys.includes('CLOSE')||keys.includes('PRICE'))){hi=i;rawHeaders=rows[i];break;}
  }
  if(hi<0)throw new Error('Could not find PSX market headers (SYMBOL / CURRENT)');

  const si=findHeaderIndex(rawHeaders,[(r,k)=>k==='SYMBOL',(r,k)=>['SCRIP','TICKER','CODE'].includes(k)]);
  const ldcpI=findHeaderIndex(rawHeaders,[(r,k)=>k==='LDCP']);
  const openI=findHeaderIndex(rawHeaders,[(r,k)=>k==='OPEN']);
  const highI=findHeaderIndex(rawHeaders,[(r,k)=>k==='HIGH']);
  const lowI=findHeaderIndex(rawHeaders,[(r,k)=>k==='LOW']);
  const priceI=findHeaderIndex(rawHeaders,[(r,k)=>k==='CURRENT',(r,k)=>['CLOSE','CLOSINGPRICE','PRICE','LAST','RATE'].includes(k)]);
  const pctI=findHeaderIndex(rawHeaders,[(r,k)=>r.includes('%')&&r.includes('CHANGE'),(r,k)=>['CHANGEPERCENT','PERCENTCHANGE','PCTCHANGE','CHANGE%'].includes(k)]);
  const absChangeI=findHeaderIndex(rawHeaders,[(r,k)=>k==='CHANGE'&&!r.includes('%')]);
  const volI=findHeaderIndex(rawHeaders,[(r,k)=>['VOLUME','VOL','SHARES','TURNOVER'].includes(k)]);
  const peI=findHeaderIndex(rawHeaders,[(r,k)=>['PE','PERATIO','TTMPE'].includes(k)]);

  const stocks=[];
  for(const r of rows.slice(hi+1)){
    const symbol=String(r[si]||'').trim().toUpperCase();if(!symbol)continue;
    const s={symbol,state:'UNSCORED',risk:'PRIVATE DATA'};
    const price=priceI>=0?num(r[priceI]):null;if(price!=null)s.price=price;
    const pct=pctI>=0?num(r[pctI]):null;if(pct!=null)s.change=pct;
    const abs=absChangeI>=0?num(r[absChangeI]):null;if(abs!=null)s.pointChange=abs;
    const ldcp=ldcpI>=0?num(r[ldcpI]):null;if(ldcp!=null)s.ldcp=ldcp;
    const open=openI>=0?num(r[openI]):null;if(open!=null)s.open=open;
    const high=highI>=0?num(r[highI]):null;if(high!=null)s.dayHigh=high;
    const low=lowI>=0?num(r[lowI]):null;if(low!=null)s.dayLow=low;
    const vol=volI>=0?num(r[volI]):null;if(vol!=null){s.volume=vol;s.avgVol=s.avgVol??null;}
    const pe=peI>=0?num(r[peI]):null;if(pe!=null)s.pe=pe;
    stocks.push(s);
  }
  if(!stocks.length)throw new Error('No valid PSX stock rows were found');
  return {meta:{asOf:inferAsOf(fileName),source:`Private PSX daily file: ${fileName}`,format:'PSX Daily Market Summary'},stocks};
}

function parseJson(text,fileName){
  const obj=JSON.parse(text);
  if(Array.isArray(obj))return {meta:{asOf:new Date().toISOString(),source:`Private JSON: ${fileName}`},stocks:obj};
  if(!obj||typeof obj!=='object')throw new Error('JSON must be an object or array');
  return obj;
}

function mergeWithExisting(snapshot,fileName){
  let existing=null;try{const raw=localStorage.getItem(LOCAL_KEY);existing=raw?JSON.parse(raw):null;}catch{}
  const prior=existing?.snapshot||{};
  const merged={
    ...prior,
    ...snapshot,
    meta:{...(prior.meta||{}),...(snapshot.meta||{})},
    market:snapshot.market??prior.market,
    stocks:Array.isArray(snapshot.stocks)&&snapshot.stocks.length?snapshot.stocks:(prior.stocks||[])
  };
  return {name:fileName,importedAt:new Date().toISOString(),snapshot:merged};
}

function attach(){
  const input=document.getElementById('localFile');if(!input)return;
  input.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    e.stopImmediatePropagation();
    try{
      const text=await file.text();
      const isJson=file.name.toLowerCase().endsWith('.json');
      const snapshot=isJson?parseJson(text,file.name):parsePsxDaily(text,file.name);
      localStorage.setItem(LOCAL_KEY,JSON.stringify(mergeWithExisting(snapshot,file.name)));
      location.reload();
    }catch(err){alert(`Could not load PSX file: ${err.message}`);e.target.value='';}
  },true);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach,{once:true});else attach();
