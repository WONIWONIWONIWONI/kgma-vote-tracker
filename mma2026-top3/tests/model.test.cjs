const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../dist/model.js');
function row(at,votes=[50,30,10],ids=['a','b','c']){return {sourceAt:at,observedAt:at,totalVotes:1000,top3:votes.map((votes,i)=>({id:ids[i],name:ids[i].toUpperCase(),rank:i+1,votes}))};}
const doc=rows=>({schemaVersion:1,sourceUrl:M.SOURCE,collector:{state:'ok'},snapshots:rows});
test('waiting document stays empty without invented leaders',()=>assert.equal(M.normalize(doc([])).snapshots.length,0));
test('requires exactly three unique ranked candidates and consistent totals',()=>{
  const r=row('2026-10-15T01:00:00Z');assert.equal(M.normalize(doc([r])).snapshots[0].top3.length,3);
  for(const change of [r=>r.top3.pop(),r=>r.top3[2].id='a',r=>r.top3[1].votes=70,r=>r.totalVotes=40,r=>r.top3[0].reportedShare=90]){const bad=structuredClone(r);change(bad);assert.throws(()=>M.normalize(doc([bad])));}
});
test('hourly uses stable IDs even when ranks swap, and includes third place',()=>{
  const a=row('2026-10-15T00:00:00Z',[50,30,10]),b=row('2026-10-15T01:00:00Z',[80,70,20],['b','a','c']);
  const hour=M.hourly([a,b],b.top3).find(r=>r.start===Date.parse(a.sourceAt));
  assert.deepEqual(hour.values.map(v=>v.delta),[50,20,10]);assert.ok(hour.values.every(v=>v.complete));
});
test('missing team in the previous observation does not become zero increase',()=>{
  const a=row('2026-10-15T00:10:00Z'),b=row('2026-10-15T00:20:00Z',[60,40,20],['a','b','d']);
  const hour=M.hourly([a,b],b.top3)[0];assert.equal(hour.values[2].delta,null);assert.equal(hour.values[0].complete,false);
});
test('a gap between observed hours never creates an estimated increase',()=>{
  const a=row('2026-10-15T00:10:00Z'),b=row('2026-10-15T03:10:00Z',[60,40,20]);
  assert.ok(M.hourly([a,b],b.top3).every(h=>h.values.every(v=>v.delta===null)));
});
test('candle opens at the prior observation and preserves OHLC extrema',()=>{
  const rows=[row('2026-10-15T00:50:00Z',[50,30,10]),row('2026-10-15T01:05:00Z',[80,30,10]),row('2026-10-15T01:10:00Z',[70,60,20])];
  const candle=M.candles(rows,60)[1];assert.deepEqual([candle.open,candle.high,candle.low,candle.close],[20,50,10,10]);
});
test('observation time is kept distinct when the source timestamp is unavailable',()=>{
  const r=row('2026-10-15T00:00:00Z');r.sourceAt=null;assert.equal(M.normalize(doc([r])).snapshots[0].sourceAt,null);assert.equal(M.stamp(r),Date.parse(r.observedAt));
});
test('rejects ambiguous timezones and invalid source timestamps',()=>{
  const r=row('2026-10-15T00:00:00Z');r.observedAt='2026-10-15T00:00:00';assert.throws(()=>M.normalize(doc([r])));
  r.observedAt='2026-10-15T00:00:00Z';r.sourceAt='invalid';assert.throws(()=>M.normalize(doc([r])));
});
