/* Exact differences between observed endpoints; no interpolation or zero filling. */
((root) => {
  'use strict';
  const HOUR = 3600000;
  const dayKey = time => new Date(time + 9 * HOUR).toISOString().slice(0, 10);

  function build(snapshots, teams) {
    if (!snapshots.length) return [];
    const rows = [...snapshots].sort((a, b) => Date.parse(a.sourceAt) - Date.parse(b.sourceAt));
    const first = Date.parse(rows[0].sourceAt), last = Date.parse(rows.at(-1).sourceAt);
    const firstHour = Math.floor(first / HOUR) * HOUR;
    const lastHour = Math.floor(last / HOUR) * HOUR;
    const buckets = new Map();
    for (let hour = firstHour; hour <= lastHour; hour += HOUR) buckets.set(hour, []);
    for (const row of rows) {
      const time = Date.parse(row.sourceAt), hour = Math.floor(time / HOUR) * HOUR;
      buckets.get(hour).push(row);
      // An exact boundary closes the preceding hour and starts the next one.
      if (time === hour && buckets.has(hour - HOUR)) buckets.get(hour - HOUR).push(row);
    }
    return [...buckets].map(([start, observations]) => {
      const end = start + HOUR;
      const values = teams.map(team => {
        const points = observations.flatMap(row => {
          const observed = row.top2.find(item => item.id === team.id);
          return observed ? [{time: Date.parse(row.sourceAt), votes: observed.votes}] : [];
        });
        if (points.length < 2) return {id: team.id, delta: null, from: null, to: null, complete: false};
        const a = points[0], b = points.at(-1);
        return {id: team.id, delta: b.votes - a.votes, from: a.time, to: b.time,
                complete: a.time === start && b.time === end};
      });
      return {start, end, date: dayKey(start), ongoing: end > last, values};
    }).reverse();
  }

  const api = {build, dayKey};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KGMAHourly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
