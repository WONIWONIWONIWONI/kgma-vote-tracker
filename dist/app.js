/* VOTE/TRACK: observed points only; straight lines bridge missing observations. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nf = new Intl.NumberFormat('ko-KR');
  const palette = ['#c2ee64', '#b3a2ff', '#76cef0', '#f1b87a', '#ed9cca', '#8cd5b1'];
  const colors = {rescene:palette[0],riize:palette[1]};
  const gapDefs = [{id:'gap12',name:'1–2위',a:0,b:1,color:palette[0]}];
  const state = {data:window.KGMA_SEED,metric:'votes',range:'all',historyLimit:12,hourlyDate:null,hourlyLimit:6,fetching:false,loadFailed:false,historyLoaded:false,lastCheckedAt:0};
  const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => nf.format(n);
  const share = (team,snap) => 100*team.votes/snap.totalVotes;
  const displayShare = (team,snap) => Number.isFinite(team.reportedShare)?team.reportedShare.toFixed(1):share(team,snap).toFixed(1);
  const normalizedId = team => String(team.id||team.name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  function colorOf(team){const id=normalizedId(team);if(colors[id])return colors[id];let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return palette[3+h%3];}
  function kst(iso,mode='full') {const d=new Date(iso);const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const f=Object.fromEntries(p.map(x=>[x.type,x.value]));return mode==='time'?`${f.hour}:${f.minute}`:mode==='short'?`${f.month}.${f.day} ${f.hour}:${f.minute}`:`${f.year}.${f.month}.${f.day} ${f.hour}:${f.minute}`;}
  function normalize(data) {
    if(!data || ![1,2].includes(data.schemaVersion) || !Array.isArray(data.snapshots) || !data.snapshots.length)throw new Error('기록 형식이 올바르지 않습니다.');
    const seen=new Set();
    const snapshots=data.snapshots.map(original=>{
      const {top3:legacy,...rest}=original;const s={...rest,top2:original.top2??legacy?.slice(0,2)};
      if(!Number.isFinite(Date.parse(s.sourceAt))||seen.has(s.sourceAt)||!Number.isSafeInteger(s.totalVotes)||s.totalVotes<=0||!Array.isArray(s.top2)||s.top2.length!==2)throw new Error('유효하지 않은 집계 기록입니다.');
      seen.add(s.sourceAt);let sum=0;const ids=new Set();
      const top2=s.top2.map((t,i)=>{
        if(!t.name||!Number.isSafeInteger(t.votes)||t.votes<0||t.votes>s.totalVotes)throw new Error('득표수 형식이 올바르지 않습니다.');
        const id=normalizedId(t);if(ids.has(id))throw new Error('중복된 아티스트입니다.');ids.add(id);sum+=t.votes;
        if(i&&s.top2[i-1].votes<t.votes)throw new Error('순위와 표수가 일치하지 않습니다.');
        if(t.reportedShare!=null&&(!Number.isFinite(t.reportedShare)||Math.abs(t.reportedShare-100*t.votes/s.totalVotes)>.151))throw new Error('점유율과 표수가 일치하지 않습니다.');
        return {...t,id,rank:i+1};
      });if(sum>s.totalVotes)throw new Error('총투표수보다 상위 득표수의 합이 큽니다.');
      return {...s,top2};
    }).sort((a,b)=>Date.parse(a.sourceAt)-Date.parse(b.sourceAt));
    return {...data,schemaVersion:2,snapshots};
  }
  const liveHistoryURL = 'https://raw.githubusercontent.com/WONIWONIWONIWONI/kgma-vote-tracker/main/dist/data/history.json';
  const liveLatestURL=liveHistoryURL.replace('history.json','latest.json');
  const refreshEvery=300000,refreshOffset=145000,retryEvery=20000;
  const operationEnd=()=>Date.parse(state.data.operation?.endsAt||'2026-10-20T15:45:00Z');
  const latest = () => state.data.snapshots.at(-1);
  function previousObservation(){return state.data.snapshots.at(-2)||null;}
  function getSeries() {return state.metric==='gap'?gapDefs:latest().top2.map(t=>({id:t.id,name:t.name,color:colorOf(t)}));}
  function getValue(s,series) {if(state.metric==='gap')return s.top2[series.a].votes-s.top2[series.b].votes;const team=s.top2.find(t=>t.id===series.id);return team?(state.metric==='share'?share(team,s):team.votes):null;}
  function windowSnapshots(){const all=state.data.snapshots;if(state.range==='all')return all;const min=Date.parse(latest().sourceAt)-Number(state.range)*3600000;return all.filter(s=>Date.parse(s.sourceAt)>=min);}
  function change(v,digits=0){return `${v>0?'+':v<0?'−':''}${digits?Math.abs(v).toFixed(digits):fmt(Math.abs(v))}`;}
  function status(){const last=latest();const capture=last.origin==='user_capture';const stale=Date.now()-Date.parse(last.sourceAt)>10*60000;const failed=state.data.collector?.state==='error';const stopped=state.data.collector?.state==='stopped'||Date.now()>=operationEnd();$('status-pill').className='status-pill '+(capture?'':stale||failed||stopped?'stale':'live');$('status-label').textContent=capture?'캡처 기록':failed?'수집 오류':stopped?'수집 종료':stale?'갱신 지연':'최근 수집 확인';$('source-time').textContent=kst(last.sourceAt);$('collected-time').textContent=last.collectedAt?`수집 ${kst(last.collectedAt,'time')}`:'';let note=capture?'첨부 화면의 실제 수치 1건입니다. 자동 수집 연결 전이며, 기록이 더 쌓이면 추이선이 표시됩니다.':failed?'최근 수집에 실패했습니다. 마지막으로 확인한 기록을 표시하며, 누락된 값은 채우지 않습니다.':stopped?'설정된 수집 기간이 끝났습니다. 마지막으로 저장된 기록을 표시합니다.':stale?'원본 집계 시각이 10분 이상 지났습니다. 아래 집계 시각의 수치를 표시합니다.':'매시 2분부터 5분 간격으로 자료를 수집합니다. (02·07·12·17분…)';if(state.loadFailed)note+=' 최신 기록 파일을 불러오지 못해 보관된 기록을 표시합니다.';$('notice-text').textContent=note;$('notice').className='notice '+(!capture&&!stale&&!failed?'good':'');}
  function renderCards(){const last=latest();$('leaders').innerHTML=last.top2.map((t,i)=>`<article class="leader ${i===0?'first':''}" style="--color:${colorOf(t)}"><div class="leader-top"><span class="rank-badge"><b>${String(i+1).padStart(2,'0')}</b> RANK</span>${i===0?'<span class="mini-label">현재 선두</span>':''}</div><h2 class="artist" title="${escapeHTML(t.name)}"><i class="artist-dot"></i><span class="artist-name">${escapeHTML(t.name)}</span></h2><div class="count-row"><span class="vote-total"><strong class="vote-value">${fmt(t.votes)}</strong><span class="unit">표</span></span><span class="share-value">${displayShare(t,last)}<span>%</span></span></div><div class="leader-bottom"><span>전체 투표 중 점유율</span><b>${i===0?`2위와 ${fmt(t.votes-last.top2[1].votes)}표 차이`:`1위와 ${fmt(last.top2[0].votes-t.votes)}표 차이`}</b></div></article>`).join('');$('total-votes').textContent=fmt(last.totalVotes);$('sample-count').textContent=fmt(state.data.snapshots.length);const sum=last.top2.reduce((s,t)=>s+t.votes,0);$('top-share').textContent=(sum/last.totalVotes*100).toFixed(1)+'%';$('other-share').textContent=((last.totalVotes-sum)/last.totalVotes*100).toFixed(1)+'%';$('share-track').innerHTML=last.top2.map(t=>`<i style="width:${share(t,last)}%;background:${colorOf(t)}" title="${escapeHTML(t.name)} ${displayShare(t,last)}%"></i>`).join('')+`<i style="width:${100-sum/last.totalVotes*100}%;background:#3b4332" title="그 외"></i>`;}
  function renderPace(){const last=latest(),prev=previousObservation();$('pace-tag').textContent=prev?`${fmt((Date.parse(last.sourceAt)-Date.parse(prev.sourceAt))/60000)}분 간격`:'기록 대기';$('pace-body').innerHTML=last.top2.map(t=>{const p=prev?.top2.find(x=>x.id===t.id);const delta=p?t.votes-p.votes:null,pp=p?share(t,last)-share(p,prev):null;return `<tr><td><span class="table-artist" style="--color:${colorOf(t)}"><i></i>${escapeHTML(t.name)}</span></td><td class="${delta==null?'no-value':delta>=0?'positive':'negative'}">${delta==null?'—':change(delta)+'표'}</td><td class="${pp==null?'no-value':pp>=0?'positive':'negative'}">${pp==null?'—':change(pp,2)+'%p'}</td></tr>`;}).join('');$('pace-note').textContent=prev?`${kst(prev.sourceAt,'short')} → ${kst(last.sourceAt,'short')} · 직전 관측 대비 변화입니다. 직전 관측에서 상위 2위 밖인 팀은 비교 값이 없습니다.`:'관측 기록이 두 개 이상이면 직전 관측 대비 변화를 표시합니다. 아직 없는 값은 —로 표시합니다.';}
  function renderHistory(){const all=[...state.data.snapshots].reverse();$('history-count').textContent=`${fmt(all.length)}회 관측`;$('history-body').innerHTML=all.slice(0,state.historyLimit).map(s=>`<tr><td>${kst(s.sourceAt,'short')}${s.origin==='user_capture'?' · 캡처':''}</td>${s.top2.map(t=>`<td><span class="history-name">${escapeHTML(t.name)}</span>${fmt(t.votes)}<span class="history-name" style="display:inline;margin-left:7px">${displayShare(t,s)}%</span></td>`).join('')}<td>${fmt(s.top2[0].votes-s.top2[1].votes)}표</td></tr>`).join('');$('load-more').hidden=all.length<=state.historyLimit;}
  function renderHourly(){
    const teams=latest().top2,all=KGMAHourly.build(state.data.snapshots,teams);
    const dates=[...new Set(all.map(row=>row.date))];
    const selected=dates.includes(state.hourlyDate)?state.hourlyDate:dates[0];
    $('hourly-date').innerHTML=dates.map(date=>`<option value="${date}"${date===selected?' selected':''}>${date.replaceAll('-','.')} KST</option>`).join('');
    const rows=all.filter(row=>row.date===selected),max=Math.max(1,...rows.flatMap(row=>row.values.map(value=>Math.abs(value.delta??0))));
    $('hourly-list').innerHTML=rows.slice(0,state.hourlyLimit).map(row=>{
      const complete=row.values.every(value=>value.complete),empty=row.values.every(value=>value.delta==null);
      const label=empty?'비교 기록 대기':complete?'1시간 전체':row.ongoing?'집계 중':'일부 구간';
      const end=KGMAHourly.dayKey(row.end)!==row.date?'24:00':kst(row.end,'time');
      return `<li class="hourly-row"><div class="hourly-row-heading"><h3>${kst(row.start,'time')}–${end}</h3><span class="hourly-badge${complete?' complete':''}">${label}</span></div><div class="hourly-pair">${teams.map(team=>{
        const value=row.values.find(item=>item.id===team.id);
        const missing=value.delta==null,negative=value.delta<0;
        const coverage=missing?'비교할 관측 기록이 부족합니다.':!value.complete?`${kst(value.from,'time')}–${kst(value.to,'time')} 실제 관측 (${fmt((value.to-value.from)/60000)}분)` : '';
        return `<div class="hourly-team${negative?' decreasing':''}" style="--color:${colorOf(team)}"><span class="hourly-team-name" title="${escapeHTML(team.name)}"><i></i>${escapeHTML(team.name)}</span><div class="hourly-track" aria-hidden="true"><span style="width:${missing?0:Math.abs(value.delta)/max*100}%"></span></div><strong class="hourly-value${missing?' no-value':negative?' negative':''}">${missing?'—':change(value.delta)+'<small>표</small>'}</strong>${coverage?`<span class="hourly-coverage">${coverage}</span>`:''}</div>`;
      }).join('')}</div></li>`;
    }).join('');
    $('hourly-more').hidden=rows.length<=state.hourlyLimit;
    $('hourly-more').textContent=`이날 전체 시간 보기 (${fmt(rows.length)}개 구간)`;
    $('hourly-note').textContent='선택한 날짜의 막대는 같은 눈금입니다. 완전한 한 시간은 정시 기록끼리 비교하며, 일부 구간은 실제 비교 시각을 표시합니다. 기록이 없으면 —, 확인된 증가가 없으면 0표입니다.';
  }
  function axisLabel(value,axis){
    return state.metric==='share'?value.toFixed(axis.decimals)+'%':fmt(value);
  }
  function axisRangeLabel(g){
    return `세로축 자동 범위 · ${axisLabel(g.ymin,g.axis)}–${axisLabel(g.ymax,g.axis)}${state.metric==='share'?'':'표'}`;
  }
  function graphGeometry(){
    const rows=windowSnapshots(),series=getSeries();
    const W=Math.max(240,Math.floor($('trend-chart').getBoundingClientRect().width||800));
    const H=W<600?300:310;
    const values=rows.flatMap(row=>series.map(line=>getValue(row,line))).filter(Number.isFinite);
    const axis=KGMAAxis.fit(values,state.metric,W<600?4:5);
    const labelWidth=Math.max(...axis.ticks.map(value=>axisLabel(value,axis).length))*6.5;
    const left=Math.max(49,Math.ceil(labelWidth)+14);
    const box={x:left,y:18,w:W-left-15,h:H-62};
    const times=rows.map(row=>Date.parse(row.sourceAt));
    let xmin=times[0],xmax=times.at(-1);
    if(xmin===xmax){xmin-=300000;xmax+=300000;}
    return {rows,series,W,H,box,xmin,xmax,axis,ymin:axis.min,ymax:axis.max,
      x:time=>box.x+(time-xmin)/(xmax-xmin)*box.w,
      y:value=>box.y+box.h-(value-axis.min)/(axis.max-axis.min)*box.h};
  }
  function renderChart(){
    const g=graphGeometry(),{rows,series,W,H,box,x,y,xmin,xmax,axis}=g;
    const svg=$('trend-chart');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.style.height=`${H}px`;
    svg.dataset.ymin=String(g.ymin);svg.dataset.ymax=String(g.ymax);
    const unit=state.metric==='share'?'%':'표';
    $('chart-unit').textContent=state.metric==='votes'?'득표수 (표)':state.metric==='share'?'전체 대비 점유율 (%)':'1–2위 표차 (표)';
    $('chart-axis-note').textContent=axisRangeLabel(g);
    $('chart-legend').innerHTML=series.map(line=>`<span class="legend-item" style="--color:${line.color}"><i></i>${escapeHTML(line.name)}</span>`).join('');
    const grid=axis.ticks.map((value,i)=>`<line x1="${box.x}" y1="${y(value)}" x2="${box.x+box.w}" y2="${y(value)}" stroke="#343c2c" stroke-dasharray="${i?'3 5':'0'}" stroke-width="1"/><text class="y-tick" x="${box.x-10}" y="${y(value)+4}" text-anchor="end" fill="#9ba58c" font-size="11">${axisLabel(value,axis)}</text>`);
    const labelCount=W<480?2:W<800?4:6;
    const labels=rows.length===1?[Date.parse(rows[0].sourceAt)]:Array.from({length:labelCount},(_,i)=>xmin+(xmax-xmin)*i/(labelCount-1));
    labels.forEach((time,i)=>grid.push(`<text class="x-tick" x="${x(time)}" y="${box.y+box.h+27}" text-anchor="${labels.length===1?'middle':i===0?'start':i===labels.length-1?'end':'middle'}" fill="#9ba58c" font-size="10">${kst(new Date(time).toISOString(),xmax-xmin>86400000?'short':'time')}</text>`));
    let paths='';for(const s of series){let path='',active=false;for(const r of rows){const v=getValue(r,s),time=Date.parse(r.sourceAt);if(v==null)continue;path+=`${active?'L':'M'}${x(time).toFixed(2)},${y(v).toFixed(2)} `;active=true;}paths+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;for(let i=0;i<rows.length;i++){const r=rows[i],v=getValue(r,s);if(v==null)continue;if(rows.length>100&&i!==rows.length-1)continue;paths+=`<circle cx="${x(Date.parse(r.sourceAt))}" cy="${y(v)}" r="${rows.length===1?5:3}" fill="${s.color}" stroke="#191c17" stroke-width="2"><title>${escapeHTML(s.name)} · ${kst(r.sourceAt)} · ${state.metric==='share'?v.toFixed(2):fmt(v)}${unit}</title></circle>`;}}
    if(rows.length===1){grid.push(`<line x1="${x(Date.parse(rows[0].sourceAt))}" x2="${x(Date.parse(rows[0].sourceAt))}" y1="${box.y}" y2="${box.y+box.h}" stroke="#6c785a" stroke-dasharray="3 6"/><text x="${box.x+box.w-4}" y="${box.y+14}" text-anchor="end" fill="#9da98c" font-size="10">다음 관측 대기 중</text>`);}
    const hits=rows.map((r,i)=>`<rect x="${x(Date.parse(r.sourceAt))-Math.max(3,Math.min(24,box.w/rows.length/2))}" y="${box.y}" width="${Math.max(6,Math.min(48,box.w/rows.length))}" height="${box.h}" fill="transparent" data-point="${i}" tabindex="0" aria-label="${escapeHTML(kst(r.sourceAt)+' 집계 기록')}"/>`).join('');svg.innerHTML=`<title>${escapeHTML($('chart-unit').textContent)} 추이</title><desc>관측된 ${rows.length}개 기록. ${axisRangeLabel(g)}. 관측점 사이의 미관측 구간도 직선으로 연결합니다. 선 중간은 실제 관측값이 아닙니다.</desc>${grid.join('')}${paths}${hits}`;svg.setAttribute('aria-label',`${$('chart-unit').textContent} 추이, ${rows.length}개 기록`);svg.querySelectorAll('[data-point]').forEach(el=>{const show=()=>showTooltip(rows[Number(el.dataset.point)],series,el,g);el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',hideTooltip);el.addEventListener('blur',hideTooltip);});$('chart-note').textContent=rows.length===1?'실제 기록 1건 · 추이선은 두 번째 기록부터 표시됩니다.':state.metric==='gap'?'각 시점의 순위 간 표차 · 미관측 구간은 직선 연결 (중간값은 미관측)':'현재 상위 2팀을 팀별로 추적 · 미관측 구간은 직선 연결 (중간값은 미관측)';$('chart-window').textContent=`${kst(rows[0].sourceAt,'short')} — ${kst(rows.at(-1).sourceAt,'short')}`;
  }
  function showTooltip(s,series,el,g){const tt=$('tooltip');tt.innerHTML=`<strong>${kst(s.sourceAt)} KST</strong>`+series.map(line=>{const v=getValue(s,line);return `<p><span><i style="background:${line.color}"></i>${escapeHTML(line.name)}</span><b>${v==null?'—':state.metric==='share'?v.toFixed(2)+'%':fmt(v)+'표'}</b></p>`;}).join('');tt.hidden=false;const wrap=$('trend-chart').getBoundingClientRect();const p=g.x(Date.parse(s.sourceAt))/g.W*wrap.width;tt.style.left=Math.max(0,Math.min(wrap.width-tt.offsetWidth,p+12))+'px';tt.style.top='38px';}
  function hideTooltip(){$('tooltip').hidden=true;}
  function render(){status();renderCards();renderPace();renderHistory();renderChart();renderHourly();}
  function dataRevision(data){return Date.parse(data.collector?.lastAttemptAt||data.snapshots.at(-1).collectedAt||data.snapshots.at(-1).sourceAt);}
  function checkNewer(candidate){
    const currentTime=Date.parse(latest().sourceAt),nextTime=Date.parse(candidate.snapshots.at(-1).sourceAt);
    if(nextTime<currentTime||(nextTime===currentTime&&dataRevision(candidate)<dataRevision(state.data)))throw new Error('더 오래된 기록입니다.');
    return candidate;
  }
  function mergeRecent(current,recent){
    const rows=new Map(current.snapshots.map(s=>[s.sourceAt,s]));
    recent.snapshots.forEach(s=>rows.set(s.sourceAt,s));
    // A long absence or a historical edit requires a full resync, not an invented gap.
    if(!Number.isSafeInteger(recent.historyCount)||rows.size!==recent.historyCount)return null;
    return normalize({...recent,snapshots:[...rows.values()]});
  }
  async function fetchRecord(source,manual){
    const url=new URL(source);
    // A fresh URL prevents the previous five-minute response from being reused.
    url.searchParams.set('v',String(Date.now()));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('기록을 읽지 못했습니다.');
      return normalize(await response.json());
    }finally{clearTimeout(timer);}
  }
  async function refresh(manual=false){
    if(state.fetching||location.protocol==='file:')return;
    state.fetching=true;state.lastCheckedAt=Date.now();$('refresh-button').disabled=true;
    try{
      let candidate;
      if(!state.historyLoaded){candidate=await fetchRecord(liveHistoryURL,manual);}
      else{
        const recent=checkNewer(await fetchRecord(liveLatestURL,manual));
        candidate=mergeRecent(state.data,recent);
        if(!candidate)candidate=await fetchRecord(liveHistoryURL,manual);
      }
      checkNewer(candidate);
      if(candidate.historyCount!=null&&candidate.historyCount!==candidate.snapshots.length)throw new Error('전체 기록이 누락되었습니다.');
      state.data=candidate;state.historyLoaded=true;state.loadFailed=false;render();
      if(manual)toast('저장된 최신 기록을 불러왔습니다.');
    }catch{
      // Load the deployed fallback once if the first connection fails.
      if(!state.historyLoaded){
        try{const fallback=checkNewer(await fetchRecord(new URL('./data/history.json',location.href).href,manual));state.data=fallback;}catch{}
      }
      state.loadFailed=true;render();
      if(manual)toast('새 기록을 불러오지 못했습니다. 기존 기록을 유지합니다.');
    }finally{state.fetching=false;$('refresh-button').disabled=false;}
  }
  async function autoRefresh(){
    if(Date.now()>=operationEnd()||state.data.collector?.state==='stopped'){status();return;}
    if(!document.hidden)await refresh();
    scheduleRefresh();
  }
  function scheduleRefresh(){
    if(Date.now()>=operationEnd()||state.data.collector?.state==='stopped')return;
    const now=Date.now(),windowStart=Math.floor((now-refreshOffset)/refreshEvery)*refreshEvery;
    const waiting=Date.parse(latest().sourceAt)<windowStart||state.loadFailed;
    const retryUntil=windowStart+270000;
    const next=waiting&&now<retryUntil?Math.min(now+retryEvery,retryUntil):windowStart+refreshEvery+refreshOffset;
    setTimeout(autoRefresh,Math.max(1000,Math.min(next,operationEnd())-now));
  }
  function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4200);}
  function download(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  function exportCSV(){const cells=v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['집계시각_KST','출처','전체투표','순위','아티스트','득표수','전체대비점유율_%','표시점유율_%','1_2위표차']];for(const s of state.data.snapshots)for(const t of s.top2)rows.push([kst(s.sourceAt),s.origin,s.totalVotes,t.rank,t.name,t.votes,share(t,s).toFixed(4),displayShare(t,s),s.top2[0].votes-s.top2[1].votes]);download(new Blob(['\uFEFF'+rows.map(r=>r.map(cells).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'kgma-top2-history.csv');}
  async function copySummary(){const s=latest();const lines=[`[2026 KGMA] ${kst(s.sourceAt)} KST 기준`,...s.top2.map(t=>`${t.rank}위 ${t.name}: ${fmt(t.votes)}표 (${displayShare(t,s)}%)`),...gapDefs.map(g=>`${g.name} 표차: ${fmt(s.top2[g.a].votes-s.top2[g.b].votes)}표`),`총투표수 ${fmt(s.totalVotes)}표`,s.origin==='user_capture'?'첨부 화면에서 확인한 기록 · 실시간 연결 전':'Berriz 공개 투표 집계',location.protocol==='file:'?'https://berriz.in/ko/vote/2026kgma/':location.href];try{await navigator.clipboard.writeText(lines.join('\n'));toast('집계 요약을 복사했습니다.');}catch{toast('복사 권한이 없습니다. CSV 다운로드를 이용해 주세요.');}}
  async function exportPNG(){const btn=$('png-button');btn.disabled=true;try{await document.fonts.ready;const s=latest(),g=graphGeometry();const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1560;const c=canvas.getContext('2d');c.scale(2,2);c.fillStyle='#10120f';c.fillRect(0,0,1200,780);const text=(str,x,y,size=15,color='#edf0e8',weight=400)=>{c.fillStyle=color;c.font=`${weight} ${size}px "DM Sans", "Noto Sans KR", sans-serif`;c.fillText(str,x,y);};text('VOTE/TRACK',50,55,22,'#c2ee64',700);text('2026 KGMA · TOP 2',50,99,29,'#edf0e8',700);text(kst(s.sourceAt)+' KST 기준',850,94,16,'#b7c3a6');s.top2.forEach((t,i)=>{const x=50+i*560;c.fillStyle='#1b2116';c.fillRect(x,133,540,155);text(String(i+1).padStart(2,'0')+'  '+t.name,x+18,162,t.name.length>18?13:17,colorOf(t),600);text(fmt(t.votes),x+18,220,43,'#edf0e8',600);text(displayShare(t,s)+'%',x+430,218,25,colorOf(t));text(i===0?'2위와 '+fmt(t.votes-s.top2[1].votes)+'표 차이':'1위와 '+fmt(s.top2[0].votes-t.votes)+'표 차이',x+18,263,13,'#aebb9d');});text($('chart-unit').textContent+' · '+$('chart-window').textContent,50,329,16,'#c7d1bb',500);
      const xx=time=>110+(time-g.xmin)/(g.xmax-g.xmin)*1015;
      const yy=value=>665-(value-g.ymin)/(g.ymax-g.ymin)*295;
      for(const value of g.axis.ticks){
        c.strokeStyle='#35402b';c.lineWidth=1;c.beginPath();c.moveTo(110,yy(value));c.lineTo(1125,yy(value));c.stroke();
        c.textAlign='right';text(axisLabel(value,g.axis),96,yy(value)+4,11,'#a0ad92');c.textAlign='left';
      }
      for(const [j,line]of g.series.entries()){text('● '+line.name,50+j*350,355,12,line.color);c.strokeStyle=line.color;c.lineWidth=2.6;c.beginPath();let active=false;for(const r of g.rows){const v=getValue(r,line),t=Date.parse(r.sourceAt);if(v==null)continue;if(active)c.lineTo(xx(t),yy(v));else c.moveTo(xx(t),yy(v));active=true;}c.stroke();for(const r of g.rows){const v=getValue(r,line);if(v==null)continue;c.beginPath();c.fillStyle=line.color;c.arc(xx(Date.parse(r.sourceAt)),yy(v),3.2,0,Math.PI*2);c.fill();}}
      text(kst(g.rows[0].sourceAt,'short'),110,692,12,'#a0ad92');if(g.rows.length>1){c.textAlign='right';text(kst(g.rows.at(-1).sourceAt,'short'),1125,692,12,'#a0ad92');c.textAlign='left';}text(axisRangeLabel(g),50,718,11,'#c2ee64');text(g.rows.length===1?'실제 기록 1건 · 두 번째 기록부터 추이선이 표시됩니다.':$('chart-note').textContent,50,741,12,'#a0ad92');text('데이터 출처 Berriz · 비공식 팬 대시보드 · 전체 투표 대비 점유율',50,762,11,'#829272');canvas.toBlob(blob=>{if(blob)download(blob,`kgma-top2-${state.metric}.png`);else toast('이미지 생성에 실패했습니다.');},'image/png');}catch{toast('이미지 생성에 실패했습니다.');}finally{btn.disabled=false;}}
  document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{state.metric=button.dataset.metric;document.querySelectorAll('[data-metric]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});hideTooltip();renderChart();}));
  document.querySelectorAll('[data-range]').forEach(button=>button.addEventListener('click',()=>{state.range=button.dataset.range;document.querySelectorAll('[data-range]').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});hideTooltip();renderChart();}));
  $('hourly-date').addEventListener('change',event=>{state.hourlyDate=event.target.value;state.hourlyLimit=6;renderHourly();});
  $('hourly-more').addEventListener('click',()=>{state.hourlyLimit=24;renderHourly();});
  $('refresh-button').addEventListener('click',()=>refresh(true));$('csv-button').addEventListener('click',exportCSV);$('copy-button').addEventListener('click',copySummary);$('png-button').addEventListener('click',exportPNG);$('load-more').addEventListener('click',()=>{state.historyLimit+=12;renderHistory();});$('history-details').addEventListener('toggle',()=>{$('history-toggle-label').textContent=$('history-details').open?'접기':'펼치기';});let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderChart,120);});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-state.lastCheckedAt>=retryEvery&&Date.now()<operationEnd()&&state.data.collector?.state!=='stopped')refresh();});
  state.data=normalize(state.data);render();if(location.protocol!=='file:'){refresh();scheduleRefresh();}
})();
