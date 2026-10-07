/* 표차 캔들차트 — dist/candles.js
 * 1위−2위 표차를 주식 캔들(5분봉·30분봉·1시간봉)로 보여줍니다.
 * 기존 app.js 는 건드리지 않고, 이 파일이 스스로 기록(history.json)을 읽어 그립니다. */
(function () {
  'use strict';

  /* ===== 설정 (색·주소는 여기서만 바꾸면 돼요) ===== */
  var UP_COLOR = '#ff5a5f';    // 표차 확대 (빨강)
  var DOWN_COLOR = '#4a9dff';  // 표차 축소 (파랑)
  var FLAT_COLOR = '#8f968a';  // 변화 없음
  var RAW = 'https://raw.githubusercontent.com/WONIWONIWONIWONI/kgma-vote-tracker/main/';
  var HISTORY_URLS = [RAW + 'dist/data/history.json', './data/history.json', RAW + 'data/history.json'];
  var POLL_MS = 45000;
  var FRAMES = {
    '5': { min: 5, label: '5분봉', show: 72 },
    '30': { min: 30, label: '30분봉', show: 48 },
    '60': { min: 60, label: '1시간봉', show: 48 }
  };
  var FONT = 'DM Sans,Noto Sans KR,Apple SD Gothic Neo,Malgun Gothic,sans-serif';

  var state = { touch: false, tf: '30', offset: 0, map: {}, points: [], candles: [], base: null, endsAt: null, lastFull: 0, view: null, hover: -1 };
  var root, el = {};

  /* ===== 작은 도구들 ===== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function kst(t) { var d = new Date(t + 9 * 3600000); return { Y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, D: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes() }; }
  function hm(t) { var k = kst(t); return pad(k.h) + ':' + pad(k.m); }
  function md(t) { var k = kst(t); return pad(k.M) + '/' + pad(k.D); }
  function num(v) { return Math.round(v).toLocaleString('ko-KR'); }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(Math.round(v)).toLocaleString('ko-KR'); }
  function f1(n) { return Math.round(n * 10) / 10; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ===== 기록 → 한 점(1·2위 표차) ===== */
  function toPoint(s) {
    if (!s || !s.top2 || s.top2.length < 2) return null;
    var t = Date.parse(s.sourceAt);
    if (!isFinite(t)) return null;
    var tp = s.top2.slice().sort(function (x, y) { return x.rank - y.rank; });
    var a = Number(tp[0].votes), b = Number(tp[1].votes);
    if (!isFinite(a) || !isFinite(b)) return null;
    return { t: t, a: a, b: b, an: tp[0].name || '', bn: tp[1].name || '' };
  }

  /* ===== 점들 → 캔들 (시가=직전 관측 표차, 종가=구간 마지막, 고가·저가=구간 최대·최소) ===== */
  function buildCandles(points, minutes) {
    var size = minutes * 60000, out = [], prev = null, cur = null;
    points.forEach(function (p) {
      var g = p.a - p.b, start = Math.floor(p.t / size) * size;
      if (!cur || cur.t !== start) {
        var gapMin = prev ? Math.round((p.t - prev.lastT) / 60000) : 0;
        cur = { t: start, o: prev ? prev.c : g, h: 0, l: 0, c: g, n: 0, lastT: p.t, gapMin: gapMin, gapped: gapMin > 5, lead: p.an, second: p.bn, a: p.a, b: p.b };
        cur.h = cur.o; cur.l = cur.o;
        out.push(cur);
      }
      if (g > cur.h) cur.h = g;
      if (g < cur.l) cur.l = g;
      cur.c = g; cur.n++; cur.lastT = p.t; cur.lead = p.an; cur.second = p.bn; cur.a = p.a; cur.b = p.b;
      prev = cur;
    });
    return out;
  }

  /* ===== 눈금 ===== */
  function niceTicks(lo, hi, count) {
    var raw = (hi - lo) / count;
    if (!(raw > 0)) raw = 1;
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / pow;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
    step = Math.max(1, Math.round(step));
    var ticks = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t));
    return ticks;
  }

  /* ===== 화면에 보일 범위 계산 ===== */
  function margins(W) { return { l: W < 520 ? 44 : 62, r: 8, t: 14, b: 40 }; }
  function computeView(W) {
    var m = margins(W), plotW = W - m.l - m.r;
    var n = Math.min(FRAMES[state.tf].show, Math.max(10, Math.floor(plotW / 4)));
    var all = state.candles, maxOff = Math.max(0, all.length - n);
    if (state.offset > maxOff) state.offset = maxOff;
    if (state.offset < 0) state.offset = 0;
    var end = all.length - state.offset, start = Math.max(0, end - n);
    return { m: m, plotW: plotW, n: n, start: start, end: end, vis: all.slice(start, end), maxOff: maxOff };
  }

  /* ===== 그래프 그리기 (SVG 조각 문자열) ===== */
  function chartInner(W, H, v, hover) {
    var m = v.m, ph = H - m.t - m.b, vis = v.vis, s = [];
    var slot = v.plotW / Math.max(vis.length, 30);
    var lo = Infinity, hi = -Infinity;
    vis.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    if (!vis.length) { lo = 0; hi = 10; }
    var padv = Math.max((hi - lo) * 0.1, 5);
    lo -= padv; hi += padv;
    function Y(val) { return m.t + (hi - val) / (hi - lo) * ph; }

    niceTicks(lo, hi, H < 300 ? 4 : 5).forEach(function (t) {
      var y = f1(Y(t));
      s.push('<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '" stroke="#30362a" stroke-dasharray="2 4" stroke-width="1"/>');
      s.push('<text x="' + (m.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#979f8e" font-family=\'' + FONT + '\'>' + num(t) + '</text>');
    });

    var size = FRAMES[state.tf].min * 60000;
    var steps = state.tf === '5' ? [3, 6, 12, 24] : state.tf === '30' ? [2, 4, 6, 12] : [1, 2, 3, 4, 6, 12], want = Math.ceil(42 / slot), k = steps[steps.length - 1];
    for (var q = 0; q < steps.length; q++) { if (steps[q] >= want) { k = steps[q]; break; } }
    var lastDay = -1;
    vis.forEach(function (c, i) {
      var cx = m.l + slot * (i + 0.5);
      if (i === hover && !state.touch) s.push('<rect x="' + f1(cx - slot / 2) + '" y="' + m.t + '" width="' + f1(slot) + '" height="' + ph + '" fill="#ffffff0f"/>');
      if (Math.round(c.t / size) % k === 0) {
        var day = kst(c.t).D;
        s.push('<text x="' + f1(cx) + '" y="' + (H - m.b + 16) + '" text-anchor="middle" font-size="10" fill="#979f8e" font-family=\'' + FONT + '\'>' + hm(c.t) + '</text>');
        if (day !== lastDay) {
          s.push('<text x="' + f1(cx) + '" y="' + (H - m.b + 30) + '" text-anchor="middle" font-size="9" fill="#79816f" font-family=\'' + FONT + '\'>' + md(c.t) + '</text>');
          lastDay = day;
        }
      }
    });

    vis.forEach(function (c, i) {
      var cx = m.l + slot * (i + 0.5), bw = state.tf === '5' ? Math.max(2, Math.min(18, slot * 0.62)) : Math.max(2, slot - Math.max(1, slot * 0.08));
      var col = c.c > c.o ? UP_COLOR : c.c < c.o ? DOWN_COLOR : FLAT_COLOR, op = c.gapped ? 0.5 : 1;
      var yo = Y(c.o), yc = Y(c.c);
      s.push('<line x1="' + f1(cx) + '" x2="' + f1(cx) + '" y1="' + f1(Y(c.h)) + '" y2="' + f1(Y(c.l)) + '" stroke="' + col + '" stroke-width="' + (slot < 8 ? 1 : 1.4) + '" opacity="' + op + '"/>');
      s.push('<rect x="' + f1(cx - bw / 2) + '" y="' + f1(Math.min(yo, yc)) + '" width="' + f1(bw) + '" height="' + f1(Math.max(1.5, Math.abs(yo - yc))) + '" fill="' + col + '" opacity="' + op + '"/>');
    });

    if (vis.length && v.end === state.candles.length) {
      var lc = vis[vis.length - 1], ly = f1(Y(lc.c));
      s.push('<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + ly + '" y2="' + ly + '" stroke="#c2ee64" stroke-opacity="0.5" stroke-dasharray="3 4"/>');
      s.push('<text x="' + (m.l + 4) + '" y="' + (ly - 5) + '" text-anchor="start" font-size="10" fill="#c2ee64" font-family=\'' + FONT + '\'>현재 ' + num(lc.c) + '</text>');
    }
    v.slot = slot;
    return s.join('');
  }

  /* ===== 화면 그리기 ===== */
  function render() {
    if (!el.svg) return;
    var W = Math.max(300, Math.floor(el.wrap.clientWidth) || 600), H = W < 520 ? 290 : 340;
    var v = computeView(W);
    state.view = v; v.W = W; v.H = H;
    el.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    el.svg.setAttribute('width', W);
    el.svg.setAttribute('height', H);
    el.svg.innerHTML = chartInner(W, H, v, state.hover);

    var vis = v.vis;
    if (vis.length) {
      var a = vis[0], b = vis[vis.length - 1], size = FRAMES[state.tf].min * 60000;
      el.range.textContent = md(a.t) + ' ' + hm(a.t) + ' ~ ' + md(b.t) + ' ' + hm(state.tf === '5' ? b.t : b.t + size) + ' · ' + vis.length + '봉 / 전체 ' + state.candles.length + '봉';
    } else {
      el.range.textContent = '기록 없음';
    }
    el.prev.disabled = state.offset >= v.maxOff;
    el.next.disabled = state.offset <= 0;
    el.latest.disabled = state.offset <= 0;
    var btns = el.tf.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tf') === state.tf;
      btns[i].className = on ? 'selected' : '';
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    el.unit.textContent = '1·2위 표차 (표) · ' + FRAMES[state.tf].label;
  }

  function showTip(i, clientX) {
    var v = state.view, c = v && v.vis[i];
    if (!c) { el.tip.hidden = true; return; }
    var size = FRAMES[state.tf].min * 60000, last = state.candles[state.candles.length - 1] === c;
    var title = state.tf === '5' ? md(c.t) + ' ' + hm(c.t) + ' 집계' : md(c.t) + ' ' + hm(c.t) + '–' + hm(c.t + size) + ' · ' + FRAMES[state.tf].label;
    var d = c.c - c.o, col = d > 0 ? UP_COLOR : d < 0 ? DOWN_COLOR : FLAT_COLOR;
    function row(l, val) { return '<p><span>' + l + '</span><b>' + val + '</b></p>'; }
    function row2(l1, v1, l2, v2) { return '<p><span>' + l1 + ' <b>' + v1 + '</b></span><span>' + l2 + ' <b>' + v2 + '</b></span></p>'; }
    var narrow = el.wrap.clientWidth < 520;
    var h = '<strong>' + esc(title) + '</strong>' +
      (narrow ? row2('시가', num(c.o), '종가', num(c.c)) + row2('고가', num(c.h), '저가', num(c.l))
              : row('시가', num(c.o)) + row('고가', num(c.h)) + row('저가', num(c.l)) + row('종가', num(c.c))) +
      '<p><span>표차 변화</span><b style="color:' + col + '">' + signed(d) + '</b></p>' +
      '<p><span>' + esc(c.lead) + '</span><b>' + num(c.a) + '</b></p><p><span>' + esc(c.second) + '</span><b>' + num(c.b) + '</b></p>' +
      '<div class="cd-dim">관측 ' + c.n + '회';
    if (c.gapped) h += ' · 직전 관측과 ' + c.gapMin + '분 간격';
    if (last && state.tf !== '5' && c.t + size - c.lastT > 5 * 60000) h += ' · 집계 중';
    h += '</div>';
    el.tip.innerHTML = h;
    el.tip.hidden = false;
    var cx = (v.m.l + v.slot * (i + 0.5)) * (el.svg.getBoundingClientRect().width / v.W);
    var tw = el.tip.offsetWidth, W = el.wrap.clientWidth;
    el.tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
    el.tip.style.top = '30px';
  }

  function onPointer(e) {
    var v = state.view;
    state.touch = e.pointerType === 'touch';
    if (!v || !v.vis.length) return;
    var r = el.svg.getBoundingClientRect(), x = (e.clientX - r.left) * (v.W / r.width);
    var i = Math.floor((x - v.m.l) / v.slot);
    if (i < 0 || i >= v.vis.length) { hideTip(); return; }
    if (i !== state.hover) { state.hover = i; render(); }
    showTip(i, e.clientX);
  }
  function hideTip() { el.tip.hidden = true; if (state.hover !== -1) { state.hover = -1; render(); } }

  /* ===== 이미지(PNG) 저장 ===== */
  function exportPng() {
    var v0 = state.view;
    if (!v0 || !v0.vis.length) return;
    var W = 1000, H = 400, HDR = 100, FTR = 36;
    var v = computeView(W); v.vis = v0.vis; v.plotW = W - v.m.l - v.m.r; v.end = v0.end;
    var last = state.points[state.points.length - 1], lc = state.candles[state.candles.length - 1];
    var font = ' font-family=\'' + FONT + '\'';
    var a = v.vis[0], b = v.vis[v.vis.length - 1];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + (H + HDR + FTR) + '" viewBox="0 0 ' + W + ' ' + (H + HDR + FTR) + '">' +
      '<rect width="100%" height="100%" fill="#10120f"/>' +
      '<text x="28" y="40" font-size="24" font-weight="700" fill="#f2f4ee"' + font + '>KGMA TOP 2 · 표차 캔들차트 (' + FRAMES[state.tf].label + ')</text>' +
      '<text x="28" y="68" font-size="16" fill="#cfd5c7"' + font + '>최신 표차 ' + num(lc.c) + '표 · ' + esc(last.an) + ' ' + num(last.a) + ' vs ' + esc(last.bn) + ' ' + num(last.b) + '</text>' +
      '<text x="28" y="90" font-size="13" fill="#9aa093"' + font + '>표시 구간 ' + md(a.t) + ' ' + hm(a.t) + ' ~ ' + md(b.t) + ' ' + hm(b.t) + ' · 원본 집계 ' + md(last.t) + ' ' + hm(last.t) + ' KST</text>' +
      '<g transform="translate(0,' + HDR + ')">' + chartInner(W, H, v, -1) + '</g>' +
      '<text x="28" y="' + (H + HDR + 24) + '" font-size="12" fill="#7d8478"' + font + '><tspan fill="' + UP_COLOR + '">■</tspan> 표차 확대  <tspan fill="' + DOWN_COLOR + '">■</tspan> 표차 축소  · 팬이 만든 비공식 대시보드 · 데이터 출처 Berriz</text>' +
      '</svg>';
    var img = new Image();
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = W * 2; cv.height = (H + HDR + FTR) * 2;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(function (blob) {
        if (!blob) return;
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'kgma-gap-candles-' + FRAMES[state.tf].label + '.png';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
      }, 'image/png');
    };
    img.onerror = function () { alert('이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ===== 기록 읽기 · 갱신 ===== */
  function addSnaps(list) {
    var added = 0;
    list.forEach(function (s) {
      var p = toPoint(s);
      if (!p) return;
      var q = state.map[p.t];
      if (q === undefined || q.a !== p.a || q.b !== p.b) { state.map[p.t] = p; added++; }
    });
    return added;
  }
  function rebuild() {
    var before = state.candles.length;
    state.points = Object.keys(state.map).map(function (k) { return state.map[k]; }).sort(function (x, y) { return x.t - y.t; });
    state.candles = buildCandles(state.points, FRAMES[state.tf].min);
    if (state.offset > 0 && before) state.offset += state.candles.length - before;
  }
  function loadHistory(i) {
    if (i >= HISTORY_URLS.length) return Promise.reject(new Error('history not found'));
    var url = HISTORY_URLS[i];
    return fetch(url + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { if (!j || !Array.isArray(j.snapshots)) throw new Error('bad format'); return { json: j, url: url }; })
      .catch(function () { return loadHistory(i + 1); });
  }
  function loadFull() {
    return loadHistory(0).then(function (res) {
      state.base = res.url.replace(/history\.json$/, '');
      state.lastFull = Date.now();
      if (res.json.operation && res.json.operation.endsAt) state.endsAt = Date.parse(res.json.operation.endsAt);
      addSnaps(res.json.snapshots);
      rebuild(); render();
    });
  }
  function poll() {
    if (document.hidden || !state.base) return;
    if (state.endsAt && Date.now() > state.endsAt + 600000) return;
    fetch(state.base + 'latest.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var arr = Array.isArray(j) ? j : (j.snapshots || j.latest || []);
        if (!arr.length) return;
        var lastKnown = state.points.length ? state.points[state.points.length - 1].t : 0;
        var first = Math.min.apply(null, arr.map(function (s) { return Date.parse(s.sourceAt) || Infinity; }));
        if (first > lastKnown + 7.5 * 60000 && Date.now() - state.lastFull > 600000) { return loadFull(); }
        if (addSnaps(arr)) { rebuild(); render(); }
      })
      .catch(function () {});
  }

  /* ===== 화면 뼈대 만들기 ===== */
  function injectStyle() {
    var st = document.createElement('style');
    st.textContent =
      '.cd-panel{margin-top:18px;padding:26px 27px 16px}' +
      '.cd-tf{display:flex;gap:4px;background:#11150f;padding:4px;border-radius:7px;border:1px solid #2a3024}' +
      '.cd-tf button{border:0;background:none;color:var(--muted);font-size:11px;border-radius:4px;padding:7px 11px}' +
      '.cd-tf button.selected{background:#333c27;color:var(--lime)}' +
      '.cd-controls{margin-top:22px;border-bottom:1px solid var(--line);padding-bottom:12px}' +
      '.cd-legend{display:flex;gap:16px;flex-wrap:wrap}' +
      '.cd-legend span{display:flex;align-items:center;gap:6px;color:#c0c8b5;font-size:10px}' +
      '.cd-legend i{display:inline-block;width:7px;height:7px;border-radius:2px}' +
      '.cd-wrap{position:relative;margin-top:16px}' +
      '.cd-unit{display:block;font-size:10px;color:var(--muted);padding:3px 0 2px;margin-bottom:10px}' +
      '.cd-wrap svg{display:block;width:100%;height:auto;overflow:visible;touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:ew-resize}' +
      '.cd-nav{display:flex;gap:8px;margin:12px 0 14px}' +
      '.cd-nav button:disabled{opacity:.35;cursor:default}' +
      '.cd-bottom{display:flex;justify-content:space-between;gap:15px;border-top:1px solid var(--line);padding-top:12px;font-size:10px;color:var(--muted);line-height:1.6}' +
      '.cd-bottom p{margin:0}.cd-bottom>span{flex-shrink:0;font-variant-numeric:tabular-nums}' +
      '.cd-tip{position:absolute;z-index:5;pointer-events:none;background:#11160ff2;box-shadow:0 5px 22px #0006;border:1px solid #536244;padding:11px 13px;border-radius:7px;font-size:11px;min-width:160px;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.cd-tip[hidden]{display:none}' +
      '.cd-tip>strong{display:block;font-size:10px;color:var(--muted);margin-bottom:8px;font-weight:600}' +
      '.cd-tip p{margin:5px 0;display:flex;align-items:center;justify-content:space-between;gap:18px}' +
      '.cd-tip b{font-weight:500}.cd-dim{font-size:10px;color:var(--muted);margin-top:8px}' +
      '.cd-empty{padding:40px 0;text-align:center;color:var(--muted);font-size:12px}' +
      '@media(max-width:900px){.cd-panel>.panel-heading{flex-wrap:wrap;align-items:flex-start}.cd-tf{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:3px}.cd-tf button{padding:8px 4px;font-size:10px}}' +
      '@media(max-width:760px){.cd-panel{padding:19px 16px 14px}.cd-controls{margin-top:20px}.cd-bottom{display:block}.cd-bottom>span{display:block;margin-top:7px}.cd-tip{font-size:10px;min-width:145px}}';
    document.head.appendChild(st);
  }
  function build() {
    root = document.getElementById('candle-panel');
    if (!root) {
      var anchor = document.querySelector('.chart-panel');
      if (!anchor || !anchor.parentNode) return false;
      root = document.createElement('section');
      root.id = 'candle-panel';
      root.className = 'panel has-image-button cd-panel';
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    }
    if (root.className.indexOf('cd-panel') < 0) root.className += ' cd-panel';
    injectStyle();
    root.innerHTML =
      '<button type="button" class="quiet-button panel-image-button" id="cd-image" aria-label="표차 캔들차트 PNG 저장" title="표차 캔들차트 PNG 저장"><span aria-hidden="true">↓</span> 이미지</button>' +
      '<div class="panel-heading"><div><div class="section-kicker">THE CANDLES</div><h2 id="cd-title">표차 캔들차트</h2></div>' +
      '<div class="cd-tf" role="group" aria-label="봉 간격" id="cd-tf"><button data-tf="5">5분</button><button data-tf="30" class="selected" aria-pressed="true">30분</button><button data-tf="60">1시간</button></div></div>' +
      '<div class="cd-controls"><div class="cd-legend"><span><i style="background:' + UP_COLOR + '"></i>표차 확대</span><span><i style="background:' + DOWN_COLOR + '"></i>표차 축소</span><span><i style="background:' + FLAT_COLOR + ';opacity:.5"></i>관측 공백 뒤</span></div></div>' +
      '<div class="cd-wrap" id="cd-wrap"><span class="cd-unit" id="cd-unit"></span><svg id="cd-svg" role="img" aria-label="1위와 2위 표차의 캔들차트"></svg><div class="cd-tip" id="cd-tip" role="status" hidden></div></div>' +
      '<div class="cd-nav"><button class="quiet-button" id="cd-prev" type="button">◀ 이전</button><button class="quiet-button" id="cd-next" type="button">다음 ▶</button><button class="quiet-button" id="cd-latest" type="button">최신</button></div>' +
      '<div class="cd-bottom"><p>표차 = 1위 − 2위 득표수. 몸통은 시가(직전 관측 표차)에서 종가(구간 마지막 표차)까지, 위·아래 선은 구간 중 최고·최저예요. 관측이 빠진 구간은 임의로 채우지 않아요. PC에서는 차트 위에서 마우스 휠을 굴려 시간축을 좌우로 이동할 수 있어요.</p><span id="cd-range"></span></div>';
    el.wrap = root.querySelector('#cd-wrap'); el.svg = root.querySelector('#cd-svg'); el.tip = root.querySelector('#cd-tip');
    el.unit = root.querySelector('#cd-unit'); el.range = root.querySelector('#cd-range'); el.tf = root.querySelector('#cd-tf');
    el.prev = root.querySelector('#cd-prev'); el.next = root.querySelector('#cd-next'); el.latest = root.querySelector('#cd-latest');
    return true;
  }
  function bind() {
    el.tf.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tf]');
      if (!b) return;
      state.tf = b.getAttribute('data-tf'); state.offset = 0; state.hover = -1; el.tip.hidden = true;
      rebuild(); render();
    });
    function page(dir) { var n = (state.view && state.view.vis.length) || 20; state.offset += dir * Math.max(1, Math.floor(n / 2)); state.hover = -1; el.tip.hidden = true; render(); }
    el.prev.addEventListener('click', function () { page(1); });
    el.next.addEventListener('click', function () { page(-1); });
    el.latest.addEventListener('click', function () { state.offset = 0; render(); });

    // 차트 위에서 마우스 휠/트랙패드 스크롤 → 시간축 좌우 이동.
    // 아래/오른쪽 = 과거(왼쪽), 위/왼쪽 = 최신(오른쪽).
    var wheelCarry = 0;
    el.svg.addEventListener('wheel', function (e) {
      if (!state.view || !state.view.vis.length || state.view.maxOff <= 0) return;
      e.preventDefault();

      var raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!raw) return;

      // 일반 마우스 휠은 한 번에 약 3봉, 트랙패드는 누적해서 부드럽게 이동.
      var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 120 : 1);
      wheelCarry += raw * unit;
      var threshold = 36;
      var steps = Math.trunc(wheelCarry / threshold);
      if (!steps) return;
      wheelCarry -= steps * threshold;

      var move = Math.max(-8, Math.min(8, steps));
      var oldOffset = state.offset;
      state.offset = Math.max(0, Math.min(state.view.maxOff, state.offset + move));
      if (state.offset !== oldOffset) {
        state.hover = -1;
        el.tip.hidden = true;
        render();
      }
    }, { passive: false });

    el.svg.addEventListener('pointermove', onPointer);
    el.svg.addEventListener('pointerdown', onPointer);
    el.svg.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hideTip(); });
    document.addEventListener('pointerdown', function (e) { if (!el.svg.contains(e.target) && !el.tip.hidden) hideTip(); });
    root.querySelector('#cd-image').addEventListener('click', exportPng);
    var timer;
    window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(render, 120); });
  }

  function start() {
    if (!build()) return;
    bind();
    render();
    loadFull().catch(function () {
      el.svg.style.display = 'none';
      var msg = document.createElement('div');
      msg.className = 'cd-empty';
      msg.textContent = '기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
      el.wrap.appendChild(msg);
    });
    setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
