/* Draw standalone panel images locally, without screenshots or remote services. */
((root) => {
  'use strict';
  const bg='#10120f',panel='#1b2117',muted='#a0ad92',ink='#edf0e8',lime='#c2ee64',warning='#edb184';
  const font='"DM Sans", "Noto Sans KR", sans-serif';
  function surface(model,height){
    const width=1000;
    // Keep long daily images inside conservative mobile canvas limits.
    const scale=Math.min(2,4096/height,Math.sqrt(8000000/(width*height)));
    const canvas=document.createElement('canvas');
    canvas.width=Math.floor(width*scale);canvas.height=Math.floor(height*scale);
    const c=canvas.getContext('2d');
    if(!c)throw new Error('Canvas is unavailable.');
    c.scale(scale,scale);c.fillStyle=bg;c.fillRect(0,0,width,height);
    const text=(value,x,y,size=16,color=ink,weight=400,align='left',maxWidth=900)=>{
      value=String(value);c.fillStyle=color;c.textAlign=align;
      do{c.font=`${weight} ${size}px ${font}`;if(c.measureText(value).width<=maxWidth||size<=10)break;size--;}while(true);
      c.fillText(value,x,y);
    };
    const line=(x1,y1,x2,y2,color='#35402b')=>{c.beginPath();c.strokeStyle=color;c.lineWidth=1;c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();};
    const rect=(x,y,w,h,color=panel)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    text('VOTE/TRACK · 2026 KGMA',48,40,17,lime,600);
    text('원본 최신 집계 '+model.sourceAt+' KST',952,40,11,muted,400,'right',590);
    text(model.title,48,91,29,ink,600);
    text(model.subtitle,48,122,13,muted);
    line(48,143,952,143);
    line(48,height-54,952,height-54);
    text('데이터 출처 Berriz · 비공식 팬 대시보드',48,height-27,11,muted);
    text('모든 시각은 한국 시간 (KST)',952,height-27,11,muted,400,'right');
    return {canvas,c,text,line,rect};
  }
  function trend(model){
    const {canvas,c,text,line,rect}=surface(model,1120);
    text('현재 득표 현황',48,177,18,ink,500);
    model.leaders.forEach((team,i)=>{
      const top=196+i*152;
      rect(48,top,904,138);rect(48,top,4,138,team.color);
      text(team.rank+'위 · '+team.name,68,top+31,26,team.color,600,'left',625);
      text('전체 투표 대비 점유율',932,top+31,12,muted,400,'right',230);
      text(team.votes,68,top+89,52,ink,600,'left',590);
      text(team.share,932,top+87,38,team.color,500,'right',240);
      text(team.gap,68,top+120,14,muted,500);
    });
    text(model.chartTitle,48,527,22,ink,600);
    const left=108,right=950,top=585,bottom=935;
    const x=time=>left+(time-model.xmin)/(model.xmax-model.xmin)*(right-left);
    const y=value=>bottom-(value-model.ymin)/(model.ymax-model.ymin)*(bottom-top);
    model.series.forEach((series,i)=>text('● '+series.name,48+i*400,553,13,series.color,500,'left',370));
    for(const tick of model.ticks){line(left,y(tick.value),right,y(tick.value));text(tick.label,left-14,y(tick.value)+4,12,muted,400,'right',90);}
    for(const series of model.series){
      c.beginPath();c.strokeStyle=series.color;c.lineWidth=3;let active=false;
      for(const point of series.points){if(point.value==null)continue;if(active)c.lineTo(x(point.time),y(point.value));else c.moveTo(x(point.time),y(point.value));active=true;}c.stroke();
      series.points.forEach((point,i)=>{if(point.value==null||(series.points.length>100&&i!==series.points.length-1))return;c.beginPath();c.fillStyle=series.color;c.arc(x(point.time),y(point.value),series.points.length===1?5:3,0,Math.PI*2);c.fill();});
    }
    text(model.firstLabel,left,963,12,muted);
    if(model.lastLabel!==model.firstLabel)text(model.lastLabel,right,963,12,muted,400,'right');
    text(model.rangeNote,48,995,13,lime);
    text(model.note,48,1024,12,muted);
    return canvas;
  }
  function pace(model){
    const {canvas,text,line}=surface(model,490);
    text('아티스트',48,187,13,muted);text('표수 변화',650,187,13,muted,400,'right');text('점유율 변화',952,187,13,muted,400,'right');
    model.rows.forEach((row,i)=>{const y=256+i*88;text('● '+row.name,48,y,23,row.color,500,'left',390);text(row.deltaText,650,y,32,row.delta==null?muted:row.delta<0?warning:lime,500,'right',250);text(row.shareText,952,y,29,row.share==null?muted:row.share<0?warning:lime,500,'right',260);line(48,y+30,952,y+30);});
    text(model.note,48,410,12,muted);
    return canvas;
  }
  function hourly(model){
    const rowHeight=150,height=173+model.rows.length*rowHeight+106;
    const {canvas,text,rect}=surface(model,height);
    model.rows.forEach((row,i)=>{
      const top=166+i*rowHeight;
      rect(48,top,904,rowHeight-10);
      text(row.label,66,top+26,17,ink,500);
      text(row.status,934,top+26,12,row.complete?lime:muted,400,'right');
      row.values.forEach((value,j)=>{
        const y=top+59+j*48;
        text('● '+value.name,66,y,15,value.color,500,'left',205);
        rect(292,y-11,445,9,'#303929');
        if(value.delta!=null)rect(292,y-11,445*Math.abs(value.delta)/model.max,9,value.delta<0?warning:value.color);
        text(value.label,934,y,20,value.delta==null?muted:value.delta<0?warning:ink,500,'right',190);
        if(value.coverage)text(value.coverage,292,y+18,11,muted,400,'left',630);
      });
    });
    text('선택 날짜 전체 · 같은 눈금으로 비교 · 일부 구간은 실제 관측 시각 표시 · —는 비교 기록 부족',48,height-77,12,muted);
    return canvas;
  }
  const painters={trend,pace,hourly};
  root.KGMAImages={render(model){const painter=painters[model.type];if(!painter)throw new Error('Unknown image panel.');return painter(model);}};
})(globalThis);
