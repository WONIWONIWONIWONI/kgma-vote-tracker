/* Source-independent, observed records only. Exports are shared by UI and tests. */
((root)=>{
  'use strict';
  const SOURCE='https://www.melon.com/mma/2026/vote/top10/';
  const stamp=s=>Date.parse(s.sourceAt||s.observedAt);
  function normalize(data){
    if(!data||data.schemaVersion!==1||data.sourceUrl!==SOURCE||!Array.isArray(data.snapshots)||!data.collector||!['pending','ok','error','stopped'].includes(data.collector.state))throw Error('올해 멜론 TOP10 기록 형식이 아닙니다.');
    const seen=new Set();
    const snapshots=data.snapshots.map(row=>{
      const zone=/(Z|[+-]\d{2}:\d{2})$/;
      if(typeof row.observedAt!=='string'||!zone.test(row.observedAt)||(row.sourceAt!=null&&(typeof row.sourceAt!=='string'||!zone.test(row.sourceAt)||!Number.isFinite(Date.parse(row.sourceAt)))))throw Error('시각에는 시간대가 포함되어야 합니다.');
      if(!Number.isFinite(stamp(row))||!Number.isFinite(Date.parse(row.observedAt))||seen.has(stamp(row)))throw Error('관측 시각이 유효하지 않거나 중복됐습니다.');
      seen.add(stamp(row));
      if(!Number.isSafeInteger(row.totalVotes)||row.totalVotes<=0||!Array.isArray(row.top3)||row.top3.length!==3)throw Error('전체 득표수와 상위 3팀 기록이 필요합니다.');
      let sum=0;const ids=new Set();
      const top3=row.top3.map((t,i)=>{
        if(!t||t.rank!==i+1||typeof t.id!=='string'||!t.id.trim()||typeof t.name!=='string'||!t.name.trim()||!Number.isSafeInteger(t.votes)||t.votes<0)throw Error('후보 순위·이름·득표수 형식이 올바르지 않습니다.');
        const id=t.id.normalize('NFKC').trim().toLowerCase();
        if(ids.has(id)||(i&&row.top3[i-1].votes<t.votes))throw Error('후보가 중복되거나 득표순이 아닙니다.');ids.add(id);sum+=t.votes;
        if(t.reportedShare!=null&&(!Number.isFinite(t.reportedShare)||Math.abs(t.reportedShare-100*t.votes/row.totalVotes)>.151))throw Error('표시 점유율이 원본 표수와 맞지 않습니다.');
        return {...t,id};
      });
      if(sum>row.totalVotes)throw Error('상위 3팀의 합이 전체 득표수를 넘었습니다.');
      return {...row,top3};
    }).sort((a,b)=>stamp(a)-stamp(b));
    return {...data,snapshots};
  }
  const dayKey=t=>new Date(t+9*3600000).toISOString().slice(0,10);
  function hourly(rows,teams){
    if(!rows.length)return [];
    const H=3600000,buckets=new Map(),first=Math.floor(stamp(rows[0])/H)*H,last=stamp(rows.at(-1));
    for(let at=first;at<=last;at+=H)buckets.set(at,[]);
    for(const row of rows){const at=stamp(row),hour=Math.floor(at/H)*H;buckets.get(hour).push(row);if(at===hour&&buckets.has(hour-H))buckets.get(hour-H).push(row);}
    return [...buckets].map(([start,values])=>({start,end:start+H,date:dayKey(start),ongoing:start+H>last,values:teams.map(team=>{
      const points=values.flatMap(row=>{const t=row.top3.find(t=>t.id===team.id);return t?[{at:stamp(row),votes:t.votes}]:[];});
      if(points.length<2)return {id:team.id,delta:null};
      const a=points[0],b=points.at(-1);return {id:team.id,delta:b.votes-a.votes,from:a.at,to:b.at,complete:a.at===start&&b.at===start+H};
    })})).reverse();
  }
  function candles(rows,minutes){
    const size=minutes*60000,result=[];let current=null,previous=null;
    for(const row of rows){const at=stamp(row),bucket=Math.floor(at/size)*size,gap=row.top3[0].votes-row.top3[1].votes;
      if(!current||current.at!==bucket){current={at:bucket,open:previous??gap,high:Math.max(previous??gap,gap),low:Math.min(previous??gap,gap),close:gap,count:1};result.push(current);}
      else{current.high=Math.max(current.high,gap);current.low=Math.min(current.low,gap);current.close=gap;current.count++;}previous=gap;
    }return result;
  }
  const api={SOURCE,stamp,normalize,dayKey,hourly,candles};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VoteModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
