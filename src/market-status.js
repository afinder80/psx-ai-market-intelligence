const holidays2026={
  '2026-02-05':'Kashmir Day',
  '2026-03-20':'Juma-Tul-Wida',
  '2026-03-21':'Eid-ul-Fitr',
  '2026-03-22':'Eid-ul-Fitr',
  '2026-03-23':'Eid-ul-Fitr / Pakistan Day',
  '2026-05-01':'Labour Day',
  '2026-05-26':'Eid-ul-Azha',
  '2026-05-27':'Eid-ul-Azha',
  '2026-05-28':'Eid-ul-Azha / Youm-e-Takbeer',
  '2026-06-25':'Ashura',
  '2026-06-26':'Ashura',
  '2026-08-14':'Independence Day',
  '2026-08-25':'Eid Milad-un-Nabi',
  '2026-11-09':'Allama Iqbal Day',
  '2026-12-25':'Quaid-e-Azam Day / Christmas'
};

function karachiParts(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,weekday:get('weekday')};
}

function latestTradingDate(dateStr){
  let d=new Date(`${dateStr}T12:00:00+05:00`);
  for(let i=0;i<10;i++){
    d=new Date(d.getTime()-86400000);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(d);
    const get=t=>parts.find(p=>p.type===t)?.value||'';
    const ds=`${get('year')}-${get('month')}-${get('day')}`;
    const wd=get('weekday');
    if(wd!=='Sat'&&wd!=='Sun'&&!holidays2026[ds]) return ds;
  }
  return 'previous trading day';
}

const el=document.getElementById('marketStatus');
if(el){
  const {date,weekday}=karachiParts();
  const holiday=holidays2026[date];
  if(holiday){
    el.textContent=`PSX Market Closed Today — ${holiday} · latest trading session: ${latestTradingDate(date)}`;
  }else if(weekday==='Sat'||weekday==='Sun'){
    el.textContent=`PSX Market Closed — Weekend · latest trading session: ${latestTradingDate(date)}`;
  }else{
    el.textContent='PSX trading day · market values update only when a current private/authorized snapshot is loaded';
  }
}
