/* No source scraping or invented records in the client. Reads the shared observation file. */
(()=>{
  'use strict';
  const M=VoteModel,$=id=>document.getElementById(id),COLORS=['#c2ee64','#b3a2ff','#76cef0'];
  const fmt=n=>new Intl.NumberFormat('ko-KR').format(n),signed=(n,d=0)=>(n>0?'+':'')+Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d,minimumFractionDigits:d});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kst=(t,timeOnly=false)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',...(timeOnly?{}:{month:'2-digit',day:'2-digit'}),hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
  const state={data:{snapshots:[],collector:{state:'pending'}},metric:'votes',hours:'all',frame:60,day:null,busy:false};
  const latest=()=>state.data.snapshots.at(-1),share=(team,row)=>100*team.votes/row.totalVotes;
  const shownShare=(team,row)=>Number.isFinite(team.reportedShare)?team.reportedShare.toFixed(1):share(team,row).toFixed(1);
  const color=team=>COLORS[latest()?.top3.findIndex(t=>t.id===team.id)]||COLORS[2];
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3500);}
  function emptySVG(){return '<text x="500" y="165" text-anchor="middle" fill="#9aa58f" font-size="17" font-family="sans-serif">확인된 관측 기록이 없습니다</text>';}
  function render(){
    const row=latest(),rows=state.data.snapshots,ok=!!row;
    document.querySelectorAll('[data-needs-record]').forEach(b=>b.disabled=!ok);
    $('day').disabled=!ok;
    $('count').textContent=fmt(rows.length)+'회';$('record-count').textContent=fmt(rows.length)+'회';
    if(!ok){
      $('status').textContent='원본 연결 대기';$('updated').textContent='확인된 집계 기록 없음';
      $('leaders').innerHTML=[1,2,3].map((rank,i)=>`<article class="leader placeholder" style="--color:${COLORS[i]}"><span class="rank">0${rank} RANK</span><h3>아티스트 확인 대기</h3><strong>—</strong><div class="share">—%</div><small>검증된 원본 수치 없음</small></article>`).join('');
      $('total').textContent='—';$('top-total').textContent='—';$('trend').innerHTML=emptySVG();$('candles').innerHTML=emptySVG();$('pace').innerHTML='';$('hourly').innerHTML='<p class="empty">확인된 관측 기록이 없습니다.</p>';$('records').innerHTML='';return;
    }
    const old=rows.at(-2),stale=Date.now()-M.stamp(row)>600000,failed=state.data.collector.state==='error';
    $('status').textContent=failed?'수집 오류':stale?'갱신 지연':'최근 관측 확인';
    $('updated').textContent=(row.sourceAt?'원본 집계 ':'관측 ')+kst(M.stamp(row))+' KST';
    $('notice').textContent=failed?'최근 수집에 실패했습니다. 마지막 정상 관측값을 유지합니다.':stale?'마지막 관측 이후 10분 이상 지났습니다. 아래 수치의 시각을 확인하세요.':row.sourceAt?'원본 집계 시각을 기준으로 기록했습니다.':'원본 집계 시각이 제공되지 않아 실제 조회 시각으로 기록했습니다.';
    $('notice').classList.toggle('error',failed||stale);
    $('leaders').innerHTML=row.top3.map((team,i)=>`<article class="leader" style="--color:${COLORS[i]}"><span class="rank">0${i+1} RANK</span><h3>${esc(team.name)}</h3><strong>${fmt(team.votes)}<small> 표</small></strong><div class="share">${shownShare(team,row)}%</div><small>전체 후보 득표 합계 대비</small></article>`).join('');
    $('total').textContent=fmt(row.totalVotes)+'표';$('top-total').textContent=fmt(row.top3.reduce((sum,t)=>sum+t.votes,0))+'표';
    $('pace').innerHTML=row.top3.map(team=>{const prev=old?.top3.find(t=>t.id===team.id),v=prev?team.votes-prev.votes:null,p=prev?share(team,row)-share(prev,old):null;return `<tr><td style="color:${color(team)}">${esc(team.name)}</td><td class="${v>=0?'up':'down'}">${v==null?'—':signed(v)+'표'}</td><td>${p==null?'—':signed(p,2)+'%p'}</td></tr>`;}).join('');
    $('pace-note').textContent=old?`${kst(M.stamp(old))} → ${kst(M.stamp(row))} · ${((M.stamp(row)-M.stamp(old))/60000).toFixed(1)}분 간격. 직전 상위 3위 밖인 팀은 비교값이 없습니다.`:'두 번째 관측부터 변화량을 표시합니다.';
    $('records').innerHTML=[...rows].reverse().slice(0,100).map(s=>`<tr><td>${kst(M.stamp(s))}<small>${s.sourceAt?'원본 집계':'관측'} 시각</small></td>${s.top3.map(t=>`<td>${esc(t.name)}<small>${fmt(t.votes)}표 · ${shownShare(t,s)}%</small></td>`).join('')}</tr>`).join('');
    renderTrend();renderCandles();renderHourly();
  }
  function axis(values){
    let min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.12,state.metric==='share'?.05:1);
    min=Math.floor(Math.max(0,min-pad)*100)/100;max=Math.ceil((max+pad)*100)/100;return {min,max,ticks:Array.from({length:5},(_,i)=>min+(max-min)*i/4)};
  }
  function plot(g,formatter){
    let out='';
    for(const tick of g.ticks){const y=g.y(tick);out+=`<line x1="96" x2="975" y1="${y}" y2="${y}" stroke="#343e2b"/><text x="83" y="${y+5}" text-anchor="end" fill="#9aa58f" font-size="13" font-family="sans-serif">${esc(formatter(tick))}</text>`;}
    for(let i=0;i<5;i++){const at=g.first+(g.last-g.first)*i/4,x=g.x(at);out+=`<text x="${x}" y="311" text-anchor="${i===0?'start':i===4?'end':'middle'}" fill="#9aa58f" font-size="12" font-family="sans-serif">${esc(kst(at))}</text>`;}return out;
  }
  function geometry(values,first,last){const a=axis(values),end=last===first?first+300000:last;return {...a,first,last:end,x:t=>96+(t-first)/(end-first)*879,y:v=>276-(v-a.min)/(a.max-a.min)*250};}
  function series(){
    if(state.metric==='gap')return [[0,1],[1,2],[0,2]].map(([a,b],i)=>({name:`${a+1}위 − ${b+1}위`,color:COLORS[i],value:s=>s.top3[a].votes-s.top3[b].votes}));
    return latest().top3.map((team,i)=>({name:team.name,color:COLORS[i],value:s=>{const t=s.top3.find(t=>t.id===team.id);return t?(state.metric==='votes'?t.votes:share(t,s)):null;}}));
  }
  function renderTrend(){
    if(!latest())return;
    const all=state.data.snapshots,cut=state.hours==='all'?-Infinity:M.stamp(latest())-Number(state.hours)*3600000,rows=all.filter(s=>M.stamp(s)>=cut),defs=series();
    const values=rows.flatMap(s=>defs.map(d=>d.value(s))).filter(v=>v!=null),g=geometry(values,M.stamp(rows[0]),M.stamp(rows.at(-1)));
    const format=v=>state.metric==='share'?v.toFixed(2)+'%':fmt(Math.round(v));
    let out=plot(g,format);
    defs.forEach(def=>{let d='';for(const row of rows){const value=def.value(row);if(value==null)continue;d+=(d?' L':'M')+g.x(M.stamp(row)).toFixed(2)+' '+g.y(value).toFixed(2);}
      out+=`<path d="${d}" fill="none" stroke="${def.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      for(const row of rows){const v=def.value(row);if(v==null)continue;out+=`<circle cx="${g.x(M.stamp(row))}" cy="${g.y(v)}" r="3" fill="${def.color}"><title>${esc(def.name+' · '+kst(M.stamp(row))+' · '+format(v))}</title></circle>`;}
    });
    $('trend').innerHTML=out;$('legend').innerHTML=defs.map(d=>`<span style="color:${d.color}">● ${esc(d.name)}</span>`).join('');
    $('trend-note').textContent=`${rows.length}개 실제 관측 · ${state.metric==='gap'?'각 시점의 순위끼리 비교':'최신 상위 3팀을 팀 ID로 추적'} · 세로축 자동 확대 · 선 사이의 중간값은 미관측`;
  }
  function renderCandles(){
    if(!latest())return;const rows=M.candles(state.data.snapshots,state.frame).slice(-48),values=rows.flatMap(r=>[r.low,r.high]),g=geometry(values,rows[0].at,rows.at(-1).at+state.frame*60000);
    let out=plot(g,v=>fmt(Math.round(v)));const w=Math.min(20,700/rows.length);
    for(const row of rows){const x=g.x(row.at+state.frame*30000),c=row.close>=row.open?'#ff7278':'#76b7ff',top=g.y(Math.max(row.open,row.close)),height=Math.max(2,Math.abs(g.y(row.open)-g.y(row.close)));
      out+=`<g><title>${esc(kst(row.at)+' · 시가 '+fmt(row.open)+' 고가 '+fmt(row.high)+' 저가 '+fmt(row.low)+' 종가 '+fmt(row.close))}</title><line x1="${x}" x2="${x}" y1="${g.y(row.high)}" y2="${g.y(row.low)}" stroke="${c}" stroke-width="1.5"/><rect x="${x-w/2}" y="${top}" width="${w}" height="${height}" fill="${c}"/></g>`;
    }$('candles').innerHTML=out;
  }
  function selectedHours(){return M.hourly(state.data.snapshots,latest().top3).filter(r=>r.date===state.day);}
  function renderHourly(){
    if(!latest())return;const days=[...new Set(state.data.snapshots.map(s=>M.dayKey(M.stamp(s))))].reverse();if(!days.includes(state.day))state.day=days[0];
    $('day').innerHTML=days.map(day=>`<option value="${day}" ${day===state.day?'selected':''}>${day}</option>`).join('');
    const rows=selectedHours(),max=Math.max(1,...rows.flatMap(r=>r.values.map(v=>Math.abs(v.delta??0))));
    $('hourly').innerHTML=rows.map(row=>`<div class="hour-block"><div class="hour-label">${kst(row.start,true)} – ${kst(row.end,true)}${row.ongoing?' · 집계 중':''}</div>${row.values.map((v,i)=>`<div class="hour-team"><span style="color:${COLORS[i]}">${esc(latest().top3[i].name)}</span><i style="width:${Math.abs(v.delta??0)/max*100}%;background:${COLORS[i]}"></i><b>${v.delta==null?'—':signed(v.delta)+'표'}<small>${v.delta==null?'':v.complete?' · 1시간':' · 일부 구간'}</small></b></div>`).join('')}</div>`).join('');
  }
  async function refresh(manual=false){
    if(state.busy)return;state.busy=true;$('refresh').disabled=true;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch('./data/history.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('기록 파일을 읽지 못했습니다.');const candidate=M.normalize(await response.json());
      if(latest()&&(!candidate.snapshots.length||candidate.snapshots.length<state.data.snapshots.length||M.stamp(candidate.snapshots.at(-1))<M.stamp(latest())))throw Error('오래되거나 누락된 응답입니다.');
      const previous=new Map(state.data.snapshots.map(row=>[M.stamp(row),row]));
      for(const row of candidate.snapshots){const old=previous.get(M.stamp(row));if(old&&(old.totalVotes!==row.totalVotes||JSON.stringify(old.top3)!==JSON.stringify(row.top3)))throw Error('동일 시각의 기록이 변경되어 기존 값을 보존합니다.');}
      state.data=candidate;render();if(manual)toast(latest()?'저장된 최신 기록을 불러왔습니다.':'아직 공식 결과가 연결되지 않았습니다.');
    }catch(error){$('notice').textContent='기록 파일을 불러오지 못했습니다. 확인된 기존 값이 있으면 그대로 보존합니다.';$('notice').classList.add('error');if(manual)toast('최신 기록을 읽지 못했습니다.');}
    finally{clearTimeout(timeout);state.busy=false;$('refresh').disabled=false;}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function csv(){const cell=v=>'"'+String(v??'').replace(/^[=+@\-]/,"'$&").replace(/"/g,'""')+'"';
    const rows=[['원본집계시각_UTC','관측시각_UTC','전체후보득표합계','순위','후보ID','아티스트','득표수','계산점유율_%']];
    for(const row of state.data.snapshots)for(const t of row.top3)rows.push([row.sourceAt,row.observedAt,row.totalVotes,t.rank,t.id,t.name,t.votes,share(t,row).toFixed(4)]);
    download(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'mma2026-top3-history.csv');
  }
  async function copy(){const row=latest();if(!row)return;const text=[`[MMA2026 TOP3] ${kst(M.stamp(row))} KST ${row.sourceAt?'원본 집계':'관측'} 기준`,...row.top3.map(t=>`${t.rank}위 ${t.name}: ${fmt(t.votes)}표 (${shownShare(t,row)}%)`),'전체 후보 득표 합계 '+fmt(row.totalVotes)+'표',M.SOURCE].join('\n');
    try{await navigator.clipboard.writeText(text);toast('집계 요약을 복사했습니다.');}catch{toast('복사 권한을 확인해 주세요.');}
  }
  async function exportPanel(kind,button){
    const row=latest();if(!row)return;button.disabled=true;
    const titles={trend:'시간에 따른 변화',candles:'1·2위 표차 흐름',pace:'직전 관측 대비 변화',hourly:'시간대별 득표 증가량'};
    const hours=kind==='hourly'?selectedHours():[],svg=kind==='trend'||kind==='candles'?new XMLSerializer().serializeToString($(kind==='trend'?'trend':'candles')):null;
    const old=state.data.snapshots.at(-2),selectedDay=state.day,trendNote=$('trend-note').textContent;
    try{
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=kind==='trend'?1130:kind==='candles'?650:kind==='pace'?450:Math.max(430,270+hours.length*100);
      const c=canvas.getContext('2d');c.fillStyle='#11140f';c.fillRect(0,0,1000,canvas.height);
      const text=(value,x,y,size=14,color='#edf3e5',max=904)=>{c.fillStyle=color;let pixels=size;do{c.font=`500 ${pixels}px sans-serif`;if(c.measureText(value).width<=max)break;pixels--;}while(pixels>9);c.fillText(value,x,y);};
      text('VOTE/TRACK · MMA2026 TOP 3',48,42,15,'#c2ee64');text(titles[kind],48,92,25);text((row.sourceAt?'원본 집계 ':'관측 ')+kst(M.stamp(row))+' KST',48,123,12,'#9aa58f');
      if(kind==='trend')row.top3.forEach((team,i)=>{const y=159+i*132;c.fillStyle='#1b2018';c.fillRect(48,y,904,118);c.fillStyle=COLORS[i];c.fillRect(48,y,3,118);text(team.rank+'위 · '+team.name,68,y+31,19,COLORS[i],630);text(fmt(team.votes)+'표',68,y+84,31);text(shownShare(team,row)+'%',760,y+84,25,COLORS[i],170);});
      if(svg){const image=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
        try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});c.drawImage(image,20,kind==='trend'?600:180,960,317);}finally{URL.revokeObjectURL(url);}
        text(kind==='trend'?trendNote:'1위−2위 표차 · 실제 관측값으로만 집계한 캔들',48,canvas.height-100,12,'#9aa58f');
      }
      if(kind==='pace')row.top3.forEach((team,i)=>{const prev=old?.top3.find(t=>t.id===team.id),delta=prev?team.votes-prev.votes:null,pp=prev?share(team,row)-share(prev,old):null;const y=200+i*65;text(team.rank+'위 · '+team.name,48,y,18,COLORS[i],450);text(delta==null?'비교 기록 없음':signed(delta)+'표 · '+signed(pp,2)+'%p',600,y,17,'#edf3e5',350);});
      if(kind==='hourly'){text(selectedDay+' · 선택 날짜의 모든 시간대',48,160,14,'#9aa58f');hours.forEach((hour,i)=>{const y=204+i*100;text(kst(hour.start,true)+' – '+kst(hour.end,true),48,y,14);hour.values.forEach((v,j)=>text(row.top3[j].name+'  '+(v.delta==null?'—':signed(v.delta)+'표'+(v.complete?'':' (일부 구간)')),220,y+j*23,13,COLORS[j],720));});}
      text('데이터 출처 Melon · 비공식 팬 대시보드',48,canvas.height-40,11,'#9aa58f');
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 생성 실패');download(blob,`mma2026-top3-${kind}-${M.stamp(row)}.png`);
    }catch{toast('이미지 저장에 실패했습니다.');}finally{button.disabled=false;}
  }
  $('refresh').addEventListener('click',()=>refresh(true));$('copy').addEventListener('click',copy);$('csv').addEventListener('click',csv);
  $('day').addEventListener('change',event=>{state.day=event.target.value;renderHourly();});
  for(const [id,key,attr,renderFn] of [['metrics','metric','metric',renderTrend],['ranges','hours','hours',renderTrend],['frames','frame','frame',renderCandles]])$(id).addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;state[key]=key==='frame'?Number(button.dataset[attr]):button.dataset[attr];$(id).querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderFn();});
  document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',()=>exportPanel(button.dataset.export,button)));
  render();if(location.protocol!=='file:')refresh();else $('notice').textContent='정적 웹 서버에서 열어야 공유 기록을 읽을 수 있습니다. 현재 공식 결과 연결은 대기 중입니다.';
  setInterval(()=>{if(!document.hidden&&state.data.snapshots.length)refresh();},300000);
})();
