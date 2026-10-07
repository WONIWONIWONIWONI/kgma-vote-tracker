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
  var FONT = '-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif';

  var state = { tf: '30', offset: 0, map: {}, points: [], candles: [], base: null, endsAt: null, lastFull: 0, view: null, hover: -1 };
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
  function margins(W) { return { l: W < 520 ? 52 : 62, r: 12, t: 14, b: 40 }; }
  function computeView(W) {
    var m = margins(W), plotW = W - m.l - m.r;
    var n = Math.min(FRAMES[state.tf].show, Math.max(10, Math.floor(plotW / 7)));
    var all = state.candles, maxOff = Math.max(0, all.length - n);
    if (state.offset > maxOff) state.offset = maxOff;
    if (state.offset < 0) state.offset = 0;
    var end = all.length - state.offset, start = Math.max(0, end - n);
    return { m: m, plotW: plotW, n: n, start: start, end: end, vis: all.slice(start, end), maxOff: maxOff };
  }

  /* ===== 그래프 그리기 (SVG 조각 문자열) ===== */
  function chartInner(W, H, v, hover) {
    var m = v.m, ph = H - m.t - m.b, vis = v.vis, s = [];
    var slot = v.plotW / Math.max(vis.length, 12);
    var lo = Infinity, hi = -Infinity;
    vis.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    if (!vis.length) { lo = 0; hi = 10; }
    var padv = Math.max((hi - lo) * 0.1, 5);
    lo -= padv; hi += padv;
    function Y(val) { return m.t + (hi - val) / (hi - lo) * ph; }

    niceTicks(lo, hi, H < 300 ? 4 : 5).forEach(function (t) {
      var y = f1(Y(t));
      s.push('<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(255,255,255,0.09)" stroke-width="1"/>');
      s.push('<text x="' + (m.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#9aa093" font-family=\'' + FONT + '\'>' + num(t) + '</text>');
    });

    var size = FRAMES[state.tf].min * 60000;
    var steps = [1, 2, 3, 4, 6, 12], want = Math.ceil(64 / slot), k = 12;
    for (var q = 0; q < steps.length; q++) { if (steps[q] >= want) { k = steps[q]; break; } }
    var lastDay = -1;
    vis.forEach(function (c, i) {
      var cx = m.l + slot * (i + 0.5);
      if (i === hover) s.push('<rect x="' + f1(cx - slot / 2) + '" y="' + m.t + '" width="' + f1(slot) + '" height="' + ph + '" fill="rgba(255,255,255,0.07)"/>');
      if (Math.round(c.t / size) % k === 0) {
        var day = kst(c.t).D;
        s.push('<text x="' + f1(cx) + '" y="' + (H - m.b + 16) + '" text-anchor="middle" font-size="11" fill="#9aa093" font-family=\'' + FONT + '\'>' + hm(c.t) + '</text>');
        if (day !== lastDay) {
          s.push('<text x="' + f1(cx) + '" y="' + (H - m.b + 30) + '" text-anchor="middle" font-size="10" fill="#7d8478" font-family=\'' + FONT + '\'>' + md(c.t) + '</text>');
          lastDay = day;
        }
      }
    });

    vis.forEach(function (c, i) {
      var cx = m.l + slot * (i + 0.5), bw = Math.max(2, Math.min(18, slot * 0.62));
      var col = c.c > c.o ? UP_COLOR : c.c < c.o ? DOWN_COLOR : FLAT_COLOR, op = c.gapped ? 0.5 : 1;
      var yo = Y(c.o), yc = Y(c.c);
      s.push('<line x1="' + f1(cx) + '" x2="' + f1(cx) + '" y1="' + f1(Y(c.h)) + '" y2="' + f1(Y(c.l)) + '" stroke="' + col + '" stroke-width="1.4" opacity="' + op + '"/>');
      s.push('<rect x="' + f1(cx - bw / 2) + '" y="' + f1(Math.min(yo, yc)) + '" width="' + f1(bw) + '" height="' + f1(Math.max(1.5, Math.abs(yo - yc))) + '" fill="' + col + '" opacity="' + op + '"/>');
    });

    if (vis.length && v.end === state.candles.length) {
      var lc = vis[vis.length - 1], ly = f1(Y(lc.c));
      s.push('<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + ly + '" y2="' + ly + '" stroke="rgba(255,255,255,0.35)" stroke-dasharray="3 4"/>');
      s.push('<text x="' + (m.l + 4) + '" y="' + (ly - 5) + '" text-anchor="start" font-size="11" fill="#e6e9df" font-family=\'' + FONT + '\'>현재 ' + num(lc.c) + '</text>');
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
    var h = '<b>' + esc(title) + '</b><br>시가 ' + num(c.o) + ' · 종가 ' + num(c.c) + '<br>고가 ' + num(c.h) + ' · 저가 ' + num(c.l) +
      '<br>표차 변화 <b style="color:' + col + '">' + signed(d) + '</b>' +
      '<br>' + esc(c.lead) + ' ' + num(c.a) + ' vs ' + esc(c.second) + ' ' + num(c.b) +
      '<br><span class="cd-dim">관측 ' + c.n + '회';
    if (c.gapped) h += ' · 직전 관측과 ' + c.gapMin + '분 간격';
    if (last && state.tf !== '5' && c.t + size - c.lastT > 5 * 60000) h += ' · 집계 중';
    h += '</span>';
    el.tip.innerHTML = h;
    el.tip.hidden = false;
    var cx = (v.m.l + v.slot * (i + 0.5)) * (el.svg.getBoundingClientRect().width / v.W);
    var tw = el.tip.offsetWidth, W = el.wrap.clientWidth;
    el.tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
    el.tip.style.top = '30px';
  }

  function onPointer(e) {
    var v = state.view;
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
      '.cd-tf{display:inline-flex;gap:4px;flex-wrap:wrap}' +
      '.cd-tf button,.cd-nav button{font:inherit;font-size:13px;color:inherit;background:transparent;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:7px 14px;min-height:36px;cursor:pointer}' +
      '.cd-tf button.selected{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.45)}' +
      '.cd-nav button:disabled{opacity:.35;cursor:default}' +
      '.cd-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;opacity:.85;margin:6px 0 2px}' +
      '.cd-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}' +
      '.cd-wrap{position:relative;margin-top:8px}' +
      '.cd-wrap svg{display:block;width:100%;height:auto;touch-action:pan-y;user-select:none;-webkit-user-select:none}' +
      '.cd-meta{display:flex;justify-content:space-between;font-size:12px;opacity:.7;margin-bottom:2px}' +
      '.cd-tip{position:absolute;z-index:5;pointer-events:none;background:#1b1e18;border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.55;white-space:nowrap;font-variant-numeric:tabular-nums;box-shadow:0 6px 20px rgba(0,0,0,.4)}' +
      '.cd-tip[hidden]{display:none}.cd-dim{opacity:.65}' +
      '.cd-nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}' +
      '.cd-range{font-size:12.5px;opacity:.75;margin-left:auto}' +
      '.cd-empty{padding:40px 0;text-align:center;opacity:.7;font-size:14px}';
    document.head.appendChild(st);
  }
  function build() {
    root = document.getElementById('candle-panel');
    if (!root) {
      var anchor = document.querySelector('.chart-panel');
      if (!anchor || !anchor.parentNode) return false;
      root = document.createElement('section');
      root.id = 'candle-panel';
      root.className = 'panel has-image-button';
      anchor.parentNode.insertBefore(root, anchor.nextSibling);
    }
    injectStyle();
    root.innerHTML =
      '<button type="button" class="quiet-button panel-image-button" id="cd-image" aria-label="표차 캔들차트 PNG 저장" title="표차 캔들차트 PNG 저장"><span aria-hidden="true">↓</span> 이미지</button>' +
      '<div class="panel-heading"><div><div class="section-kicker">THE CANDLES</div><h2 id="cd-title">표차 캔들차트</h2></div>' +
      '<div class="cd-tf" role="group" aria-label="봉 간격" id="cd-tf"><button data-tf="5">5분</button><button data-tf="30" class="selected" aria-pressed="true">30분</button><button data-tf="60">1시간</button></div></div>' +
      '<div class="cd-legend"><span><i style="background:' + UP_COLOR + '"></i>표차 확대 (1위가 더 앞서감)</span><span><i style="background:' + DOWN_COLOR + '"></i>표차 축소 (2위가 따라잡음)</span><span><i style="background:' + FLAT_COLOR + ';opacity:.5"></i>옅은 봉 = 관측 공백 뒤</span></div>' +
      '<div class="cd-wrap" id="cd-wrap"><div class="cd-meta"><span id="cd-unit"></span></div><svg id="cd-svg" role="img" aria-label="1위와 2위 표차의 캔들차트"></svg><div class="cd-tip" id="cd-tip" role="status" hidden></div></div>' +
      '<div class="cd-nav"><button id="cd-prev" type="button">◀ 이전</button><button id="cd-next" type="button">다음 ▶</button><button id="cd-latest" type="button">최신</button><span class="cd-range" id="cd-range"></span></div>' +
      '<p class="panel-footnote">표차 = 1위 − 2위 득표수. 봉 하나는 그 시간 동안 표차가 어떻게 움직였는지를 보여줘요. 몸통은 시가(직전 관측 표차)에서 종가(구간 마지막 표차)까지, 위·아래 선은 구간 중 최고·최저예요. 5분봉은 관측이 5분에 한 번이라 선 없이 몸통만 보일 수 있어요. 관측이 빠진 구간은 앞뒤 값만 이어 보여주며 임의로 채우지 않아요.</p>';
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
    el.svg.addEventListener('pointermove', onPointer);
    el.svg.addEventListener('pointerdown', onPointer);
    el.svg.addEventListener('pointerleave', hideTip);
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
