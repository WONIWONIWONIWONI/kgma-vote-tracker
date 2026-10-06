const assert = require('node:assert/strict');
const {build, dayKey} = require('../dist/hourly.js');
const teams = [{id:'a'}, {id:'b'}];
const row = (time, a, b) => ({sourceAt:`2026-10-07T${time}:00+09:00`,
  top2:[{id:'a',votes:a}, {id:'b',votes:b}]});
const hour = (rows, time) => build(rows, teams).find(r => r.start === Date.parse(`2026-10-07T${time}:00+09:00`));

// A full hour remains exact even when the observations inside it are missing.
let result = hour([row('01:00',100,80),row('01:15',120,83),row('02:00',160,120)],'01:00');
assert.deepEqual(result.values.map(v=>v.delta), [60,40]);
assert.ok(result.values.every(v=>v.complete));
assert.equal(result.ongoing, false);

// A partial first hour reports its actual endpoints, without claiming an hour total.
result = hour([row('00:45',100,80),row('01:00',115,87)],'00:00');
assert.deepEqual(result.values.map(v=>v.delta), [15,7]);
assert.equal(result.values[0].complete, false);
assert.equal(result.values[0].from, Date.parse('2026-10-07T00:45:00+09:00'));

// Never distribute a cross-boundary gap across two hours or replace it with zero.
let results = build([row('01:55',100,80),row('02:05',130,100)],teams);
assert.ok(results.every(r=>r.values.every(v=>v.delta===null)));
result = hour([row('01:00',100,80),row('03:00',150,110)],'02:00');
assert.equal(result.values[0].delta, null);

// Ongoing and negative changes stay explicit; ranking swaps follow the team ID.
const swapped = row('02:20',104,120);swapped.top2.reverse();
result = hour([row('02:00',110,100),swapped],'02:00');
assert.deepEqual(result.values.map(v=>v.delta), [-6,20]);
assert.equal(result.ongoing, true);
const absent = row('02:20',130,120);absent.top2[1]={id:'c',votes:125};
result = hour([row('02:00',110,100),absent],'02:00');
assert.equal(result.values[1].delta, null);

// Date grouping uses KST even when the browser runs in another timezone.
assert.equal(dayKey(Date.parse('2026-10-06T15:00:00Z')),'2026-10-07');
assert.equal(dayKey(Date.parse('2026-10-06T14:59:59Z')),'2026-10-06');
assert.deepEqual(build([], teams), []);
assert.equal(build([row('01:00',100,80)],teams)[0].values[0].delta,null);
console.log('Hourly aggregation passed: exact, partial, missing, ongoing, rank changes, KST.');
