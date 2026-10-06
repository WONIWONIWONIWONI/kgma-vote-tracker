/* Shared linear axis for both artists and for the screen and PNG export. */
((root) => {
  'use strict';
  function fit(values, metric = 'votes', intervals = 4) {
    const finite = values.filter(Number.isFinite);
    const share = metric === 'share', ceiling = share ? 100 : Infinity;
    const observedMin = finite.length ? Math.min(...finite) : 0;
    const observedMax = finite.length ? Math.max(...finite) : 0;
    const minimumSpan = share ? 0.04 : 4;
    const span = Math.max(observedMax - observedMin, minimumSpan);
    const center = (observedMin + observedMax) / 2;
    const lower = Math.max(0, center - span * 0.6);
    const upper = Math.min(ceiling, center + span * 0.6);
    const raw = Math.max(upper - lower, minimumSpan / 2) / intervals;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    let step = [1, 2, 2.5, 5, 10].find(value => value >= fraction - 1e-10) * power;
    if (!share) step = Math.max(1, Math.ceil(step));
    let decimals = 0;
    while (decimals < 6 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-8) decimals++;
    const clean = value => Number(value.toFixed(decimals));
    const min = clean(Math.max(0, Math.floor(lower / step + 1e-9) * step));
    let max = clean(Math.min(ceiling, Math.ceil(upper / step - 1e-9) * step));
    if (max <= min) max = clean(Math.min(ceiling, min + step));
    const ticks = [];
    for (let i = 0; i <= Math.round((max - min) / step); i++) ticks.push(clean(min + i * step));
    return {min, max, step, decimals, ticks};
  }
  const api = {fit};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KGMAAxis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
