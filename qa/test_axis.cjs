const assert = require('node:assert/strict');
const {fit} = require('../dist/axis.js');

function check(values, metric = 'votes', intervals = 4) {
  const axis = fit(values, metric, intervals);
  const observed = values.filter(Number.isFinite);
  assert.ok(Number.isFinite(axis.min) && Number.isFinite(axis.max) && axis.max > axis.min);
  assert.ok(axis.min >= 0);
  assert.ok(observed.every(value => value >= axis.min && value <= axis.max), JSON.stringify(axis));
  assert.ok(axis.ticks.length >= 3 && axis.ticks.length <= intervals + 3, JSON.stringify(axis));
  assert.equal(new Set(axis.ticks.map(value=>value.toFixed(axis.decimals))).size, axis.ticks.length);
  assert.ok(axis.ticks.every((value,i)=>i===0 || value > axis.ticks[i-1]));
  if (metric !== 'share') assert.ok(axis.ticks.every(Number.isInteger));
  else assert.ok(axis.max <= 100);
  return axis;
}

let axis = check([3091, 3200, 3331, 3506, 3700, 3776]);
assert.ok(axis.min > 2500 && axis.max - axis.min < 1200);
axis = check([415, 419, 435, 447], 'gap');
assert.ok(axis.min > 350 && axis.max - axis.min < 80);
axis = check([29.301, 29.309, 29.315], 'share');
assert.ok(axis.max - axis.min < 0.1 && axis.decimals >= 2);
for (const values of [[0], [0,1], [4000], [4000,4001], [12345678,12345683], [0,100000]]) check(values);
for (const values of [[0], [100], [0,100], [99.998,100], [29.3,29.3], [25.82,29.31]]) check(values,'share');
check([NaN,null,undefined,Infinity]);
check([3091,3506,3776],'votes',5);
// Re-selecting a shorter window must refit the common axis to only that window.
const full = fit([100,1000,5000]), recent = fit([4900,4950,5000]);
assert.ok(recent.max - recent.min < (full.max - full.min) / 10);
console.log('Adaptive axis passed: tight ranges, integer counts, distinct share labels, flat and bounded data.');
