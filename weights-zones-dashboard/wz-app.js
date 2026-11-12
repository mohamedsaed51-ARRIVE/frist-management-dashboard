/* =====================================================================
   ARRIVE — لوحة متابعة تعديل الأوزان والزونات والتحويلات
   الواجهة فقط: جلب البيانات، الفلاتر، العرض. كل الحسابات في wz-logic.js
   ===================================================================== */
(function () {
  'use strict';
  var WZ = window.WZ, CFG = window.WZ_CONFIG || {}, MISSING = WZ.MISSING;
  var $ = function (id) { return document.getElementById(id); };
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };

  var state = { model: null, sub: null, mode: '', tab: 'overview', charts: {}, tables: {}, timer: null };

  /* ---------- تنسيق ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function N(v) { return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'); }
  function N1(v) { return v == null || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function P(v) { return v == null || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function D(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : MISSING; }
  function DS(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function badge(cls, icon, label) { return '<span class="badge ' + cls + '"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i>' + esc(label) + '</span>'; }

  /* ---------- بطاقات المؤشرات ---------- */
  function stub(tone, icon, label, value, pct, sub) {
    return '<div class="stub tone-' + tone + '"><div class="stub-top"><div class="stub-ic"><i class="fa-solid fa-' + icon + '" aria-hidden="true"></i></div>' +
      '<div class="stub-main"><div class="stub-label">' + esc(label) + '</div><div class="stub-value num">' + value + '</div>' +
      (pct ? '<div class="stub-pct num">' + pct + '</div>' : '') + '</div></div><div class="stub-sub">' + (sub || '') + '</div></div>';
  }

  /* ---------- جدول عام: فرز + ترقيم ---------- */
  function table(id, cols, rows, opt) {
    opt = opt || {};
    var st = state.tables[id] || (state.tables[id] = { key: opt.sort || null, dir: opt.dir || -1, page: 1 });
    st.cols = cols; st.rows = rows; st.opt = opt;
    drawTable(id);
  }
  function drawTable(id) {
    var st = state.tables[id], cols = st.cols, opt = st.opt, el = $(id);
    if (!el) return;
    var rows = st.rows.slice();
    if (st.key) {
      var col = cols.filter(function (c) { return c.k === st.key; })[0];
      if (col) {
        var get = col.sv || function (r) { return r[col.k]; };
        rows.sort(function (a, b) {
          var x = get(a), y = get(b);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * st.dir;
        });
      }
    }
    var size = opt.pageSize === 0 ? rows.length || 1 : (opt.pageSize || 25);
    var pages = Math.max(1, Math.ceil(rows.length / size));
    if (st.page > pages) st.page = pages;
    var view = rows.slice((st.page - 1) * size, st.page * size);
    var h = '<div class="table-scroll"><table class="wz"><thead><tr>' + cols.map(function (c) {
      return '<th class="' + (c.num ? 'num ' : '') + (c.nosort ? 'nosort' : '') + '" data-k="' + c.k + '">' + esc(c.t) +
        ' <span class="arrow">' + (st.key === c.k ? (st.dir > 0 ? '▲' : '▼') : '') + '</span></th>';
    }).join('') + '</tr></thead><tbody>';
    if (!view.length) h += '<tr><td colspan="' + cols.length + '"><div class="wz-empty">' + esc(opt.empty || 'لا توجد سجلات ضمن عوامل التصفية الحالية') + '</div></td></tr>';
    view.forEach(function (r) {
      h += '<tr>' + cols.map(function (c) {
        var v = c.f ? c.f(r) : esc(r[c.k] == null || r[c.k] === '' ? '—' : r[c.k]);
        return '<td class="' + (c.num ? 'num ' : '') + (c.cls || '') + '">' + v + '</td>';
      }).join('') + '</tr>';
    });
    if (opt.total && rows.length) h += '<tr class="total">' + cols.map(function (c, i) { var v = opt.total[c.k]; return '<td class="' + (c.num ? 'num' : '') + '">' + (v == null ? (i === 0 ? 'الإجمالي' : '') : v) + '</td>'; }).join('') + '</tr>';
    h += '</tbody></table></div>';
    if (pages > 1) {
      h += '<div class="pager"><div class="pager-info">عرض ' + N((st.page - 1) * size + 1) + '–' + N(Math.min(st.page * size, rows.length)) + ' من ' + N(rows.length) + '</div><div class="pager-ctl">' +
        '<button class="pg-btn" data-pg="1"' + (st.page === 1 ? ' disabled' : '') + '><i class="fa-solid fa-angles-right"></i></button>' +
        '<button class="pg-btn" data-pg="' + (st.page - 1) + '"' + (st.page === 1 ? ' disabled' : '') + '><i class="fa-solid fa-angle-right"></i></button>' +
        '<button class="pg-btn active" disabled>' + st.page + ' / ' + pages + '</button>' +
        '<button class="pg-btn" data-pg="' + (st.page + 1) + '"' + (st.page === pages ? ' disabled' : '') + '><i class="fa-solid fa-angle-left"></i></button>' +
        '<button class="pg-btn" data-pg="' + pages + '"' + (st.page === pages ? ' disabled' : '') + '><i class="fa-solid fa-angles-left"></i></button></div></div>';
    }
    el.innerHTML = h;
    el.querySelectorAll('th').forEach(function (th) {
      if (th.classList.contains('nosort')) return;
      th.addEventListener('click', function () { var k = th.dataset.k; if (st.key === k) st.dir = -st.dir; else { st.key = k; st.dir = -1; } st.page = 1; drawTable(id); });
    });
    el.querySelectorAll('.pg-btn[data-pg]').forEach(function (b) { b.addEventListener('click', function () { st.page = +b.dataset.pg; drawTable(id); }); });
  }

  /* ---------- الرسوم ---------- */
  function chart(id, cfg) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    var el = $(id); if (!el || !window.Chart) return;
    state.charts[id] = new Chart(el.getContext('2d'), cfg);
  }
  function baseOpts(extra) {
    var grid = css('--chart-grid') || '#E2E8F0', label = css('--chart-label') || '#64748B';
    var o = {
      responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
      plugins: { legend: { labels: { color: label, font: { family: 'Cairo', size: 12 }, boxWidth: 12 } }, tooltip: { rtl: true, titleFont: { family: 'Cairo' }, bodyFont: { family: 'Cairo' } } },
      scales: {
        x: { ticks: { color: label, font: { family: 'Cairo', size: 11 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: label, font: { family: 'Inter', size: 11 }, precision: 0 }, grid: { color: grid } }
      }
    };
    if (extra) extra(o);
    return o;
  }
  function dualAxis(o, title) {
    var label = css('--chart-label') || '#64748B';
    o.scales.y1 = { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: label, font: { family: 'Inter', size: 11 } }, title: { display: !!title, text: title, color: label, font: { family: 'Cairo', size: 11 } } };
  }
  function C1() { return css('--arrive-blue') || '#0837C9'; }
  function C2() { return css('--arrive-teal') || '#00C7E6'; }
  function CRED() { return css('--status-violation') || '#EF4444'; }
  function CAMB() { return css('--status-under-action') || '#F59E0B'; }

  /* ---------- الفلاتر (Multi-select بنفس مكوّن لوحة الشكاوى) ---------- */
  var MS = {};
  function mountMS(id) {
    var sel = $(id); if (!sel || MS[id]) return;
    sel.style.display = 'none';
    var wrap = document.createElement('div'); wrap.className = 'ms'; sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
    var control = document.createElement('button'); control.type = 'button'; control.className = 'ms-control';
    control.innerHTML = '<span class="ms-chips"><span class="ms-placeholder">الكل</span></span><span class="ms-caret"><i class="fa-solid fa-chevron-down"></i></span>';
    wrap.appendChild(control);
    var panel = document.createElement('div'); panel.className = 'ms-panel';
    panel.innerHTML = '<input type="text" class="ms-search" placeholder="اكتب للبحث…" autocomplete="off"><div class="ms-actions"><button type="button" class="ms-select-all">تحديد الكل</button><button type="button" class="ms-clear-all">مسح الكل</button></div><div class="ms-options"></div>';
    wrap.appendChild(panel);
    var search = panel.querySelector('.ms-search'), box = panel.querySelector('.ms-options'), chips = control.querySelector('.ms-chips');
    function fire() { sel.dispatchEvent(new Event('change', { bubbles: true })); }
    function opts(q) {
      q = (q || '').trim().toLowerCase(); box.innerHTML = '';
      var list = [].slice.call(sel.options).filter(function (o) { return !q || o.textContent.toLowerCase().indexOf(q) >= 0; });
      if (!list.length) { box.innerHTML = '<div class="ms-empty">لا توجد نتائج</div>'; return; }
      list.forEach(function (o) {
        var row = document.createElement('label'); row.className = 'ms-option';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = o.selected;
        cb.addEventListener('change', function () { o.selected = cb.checked; fire(); sync(); });
        var sp = document.createElement('span'); sp.textContent = o.textContent;
        row.appendChild(cb); row.appendChild(sp); box.appendChild(row);
      });
    }
    function sync() {
      var s = [].slice.call(sel.selectedOptions);
      if (!s.length) { chips.innerHTML = '<span class="ms-placeholder">الكل</span>'; return; }
      chips.innerHTML = s.slice(0, 2).map(function (o) { return '<span class="ms-chip"><span>' + esc(o.textContent) + '</span></span>'; }).join('') + (s.length > 2 ? '<span class="ms-chip-more">+' + (s.length - 2) + '</span>' : '');
    }
    control.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = wrap.classList.contains('open');
      document.querySelectorAll('.ms.open').forEach(function (x) { x.classList.remove('open'); });
      if (!open) { wrap.classList.add('open'); search.value = ''; opts(''); setTimeout(function () { search.focus(); }, 0); }
    });
    search.addEventListener('input', function () { opts(search.value); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    panel.querySelector('.ms-select-all').addEventListener('click', function () { [].forEach.call(sel.options, function (o) { o.selected = true; }); fire(); opts(search.value); sync(); });
    panel.querySelector('.ms-clear-all').addEventListener('click', function () { [].forEach.call(sel.options, function (o) { o.selected = false; }); fire(); opts(search.value); sync(); });
    document.addEventListener('click', function () { wrap.classList.remove('open'); });
    MS[id] = { sync: sync, opts: opts };
  }
  function setOptions(id, values, labelFn) {
    var sel = $(id), keep = selVals(id);
    sel.innerHTML = values.map(function (v) { return '<option value="' + esc(v) + '"' + (keep.indexOf(v) >= 0 ? ' selected' : '') + '>' + esc(labelFn ? labelFn(v) : v) + '</option>'; }).join('');
    if (MS[id]) MS[id].sync();
  }
  function selVals(id) { return [].slice.call($(id).selectedOptions).map(function (o) { return o.value; }); }
  function readFilters() {
    return { months: selVals('fMonth'), branches: selVals('fBranch'), persons: selVals('fPerson'), reasons: selVals('fReason'), from: $('fFrom').value, to: $('fTo').value, q: $('fSearch').value.trim() };
  }
  function populateFilters() {
    var m = state.model, mo = {}, br = {}, pe = {}, re = {};
    m.weights.forEach(function (r) { if (r.month) mo[r.month] = 1; br[r.br] = 1; pe[r.person] = 1; re[r.reason] = 1; });
    m.transfers.forEach(function (r) { if (r.month && r.recorded) mo[r.month] = 1; br[r.br] = 1; if (r.person) pe[r.person] = 1; });
    m.zoneEdits.forEach(function (r) { if (r.month) mo[r.month] = 1; br[r.br] = 1; pe[r.person] = 1; });
    m.compliance.forEach(function (r) { if (r.state === 'sent' || r.state === 'notSent') mo[r.month] = 1; br[r.br] = 1; });
    setOptions('fMonth', Object.keys(mo).sort(), WZ.monthLabel);
    var cnt = {}; m.weights.forEach(function (r) { cnt[r.br] = (cnt[r.br] || 0) + 1; });
    setOptions('fBranch', Object.keys(br).sort(function (a, b) { return (cnt[b] || 0) - (cnt[a] || 0) || a.localeCompare(b, 'ar'); }));
    setOptions('fPerson', Object.keys(pe).sort(function (a, b) { return a.localeCompare(b, 'ar'); }));
    setOptions('fReason', Object.keys(re).sort());
  }
  function toggleBranch(name) {
    var sel = $('fBranch');
    [].forEach.call(sel.options, function (o) { if (o.value === name) o.selected = !o.selected; });
    MS.fBranch && MS.fBranch.sync(); render();
  }

  /* =====================================================================
     العرض
     ===================================================================== */
  function render() {
    var m = state.model; if (!m) return;
    var f = readFilters(), sub = state.sub = WZ.applyFilters(m, f);
    sub.f = f;
    var ws = sub.W = WZ.weightStats(sub.weights);
    sub.T = WZ.transferStats(sub.transfers); sub.Z = WZ.zoneStats(sub.zoneEdits); sub.C = WZ.complianceStats(sub.compliance);

    $('metaWeights').textContent = N(ws.count);
    $('metaBranches').textContent = N(WZ.uniq(sub.weights.concat(sub.transfers.filter(function (r) { return r.recorded && r.count > 0; })).concat(sub.zoneEdits), function (r) { return r.br; }).length);
    $('metaValue').textContent = N(ws.value);
    $('cntWeights').textContent = N(ws.count); $('cntTransfers').textContent = N(sub.T.count); $('cntZones').textContent = N(sub.Z.count);
    $('cntQuality').textContent = N(m.quality.length);
    var counts = { overview: ws.count, weights: ws.count, transfers: sub.transfers.filter(function (r) { return r.recorded; }).length, zones: sub.Z.count, compliance: sub.C.due, quality: m.quality.length, policy: m.message.length };
    $('resultCount').textContent = N(counts[state.tab]);
    var dates = sub.weights.map(function (r) { return r.d; }).filter(Boolean).sort();
    $('rangeLabel').textContent = dates.length ? 'فترة سجل الأوزان المعروضة: من ' + D(dates[0]) + ' إلى ' + D(dates[dates.length - 1]) : 'لا توجد سجلات أوزان ضمن التصفية الحالية';

    ({ overview: renderOverview, weights: renderWeights, transfers: renderTransfers, zones: renderZones, compliance: renderCompliance, quality: renderQuality, policy: renderPolicy })[state.tab]();
  }

  /* ---------- نظرة عامة ---------- */
  function renderOverview() {
    var s = state.sub, W = s.W, T = s.T, Z = s.Z, C = s.C;
    $('ovKpis').innerHTML =
      stub('brand', 'weight-scale', 'تعديلات الأوزان', N(W.count), '', N(W.shipments) + ' شحنة مختلفة · متوسط ' + N1(W.dailyAvg) + ' تعديل/يوم عمل (' + N(W.days) + ' يوم)') +
      stub('success', 'coins', 'قيمة الوزن الزائد (ج.م)', N(W.value), '', 'متوسط التعديل ' + N1(W.avgValue) + ' ج.م · المستحق للمناديب ' + N(W.courierShare) + ' ج.م') +
      stub(W.volMismatch ? 'under-action' : 'success', 'ruler-combined', 'مطابقة الوزن الحجمي للأبعاد', P(W.volMatchRate), '', N(W.volMismatch) + ' فرق من ' + N(W.volChecked) + ' سجل قابل للتحقق (سماحية ±' + WZ.RULES.VOL_TOLERANCE_KG + ' كجم)') +
      stub(T.brErr ? 'under-action' : 'in-progress', 'right-left', 'تحويلات الأفرع', N(T.count), 'أخطاء الفروع ' + P(T.brErrRate), N(T.brErr) + ' خطأ فرع · ' + N(T.respErr) + ' خطأ مسؤول تحويل · ' + N(T.days) + ' يوم مسجَّل') +
      stub(Z.err ? 'under-action' : 'in-progress', 'map-location-dot', 'تعديلات زونات المناديب', N(Z.count), N(Z.err) + ' خطأ', N(Z.couriers) + ' مندوب · ' + N(Z.errRows) + ' سجل به أخطاء · ' + N(Z.days) + ' يوم مسجَّل') +
      stub(C.notSent ? 'violation' : 'success', 'clipboard-check', 'التزام الفروع بإرسال شيت التحويلات', P(C.rate), '', N(C.sent) + ' تم الإرسال · ' + N(C.notSent) + ' لم يرسل · ' + N(C.unrecorded) + ' غير مسجَّل');

    renderAlerts(); renderInsights(); renderTop();
    dailyChart('chOvDaily', s.weights);
    branchChart('chOvBranch', s.weights, 10);

    var staff = WZ.staffStats(s);
    table('tblStaff', [
      { k: 'name', t: 'الموظف' },
      { k: 'weightReviews', t: 'تعديلات أوزان راجعها', num: true, f: function (r) { return N(r.weightReviews); } },
      { k: 'weightValue', t: 'قيمة الوزن الزائد (ج.م)', num: true, f: function (r) { return N(r.weightValue); } },
      { k: 'volMismatch', t: 'فروقات وزن حجمي', num: true, f: function (r) { return r.volChecked ? N(r.volMismatch) + ' (' + P(r.volMismatchRate) + ')' : '—'; } },
      { k: 'transfers', t: 'تحويلات نفّذها', num: true, f: function (r) { return N(r.transfers); } },
      { k: 'transferErr', t: 'أخطاء التحويلات', num: true, f: function (r) { return r.transfers ? N(r.transferErr) + ' (' + P(r.transferErrRate) + ')' : '—'; } },
      { k: 'zoneEdits', t: 'تعديلات زونات', num: true, f: function (r) { return N(r.zoneEdits); } },
      { k: 'zoneErr', t: 'أخطاء الزونات', num: true, f: function (r) { return r.zoneEdits ? N(r.zoneErr) : '—'; } },
      { k: 'totalErr', t: 'الحالة', nosort: true, f: function (r) { return r.totalErr ? badge('pending', 'triangle-exclamation', N(r.totalErr) + ' خطأ مسجَّل') : badge('accepted', 'circle-check', 'لا أخطاء مسجَّلة'); } }
    ], staff, { pageSize: 0 });
    $('ovSub').textContent = 'محسوبة ضمن عوامل التصفية الحالية · بيانات حتى ' + D(state.model.today);
  }

  function selfReview(s) {
    var t = s.transfers.filter(function (r) { return r.recorded && r.count > 0 && r.person && r.person === r.rev; });
    var z = s.zoneEdits.filter(function (r) { return r.person !== MISSING && r.person === r.rev; });
    return { tRows: t.length, tCount: WZ.sum(t, function (r) { return r.count; }), zRows: z.length, names: WZ.uniq(t.concat(z), function (r) { return r.person; }) };
  }

  function renderAlerts() {
    var s = state.sub, m = state.model, W = s.W, T = s.T, Z = s.Z, C = s.C;
    var crit = m.quality.filter(function (q) { return q.sev === 'critical' || q.sev === 'high'; });
    var list = [
      { p: 'crit', emoji: '🚫', n: C.notSent, d: 'مرة لم يرسل فيها فرع شيت التحويلات', tab: 'compliance' },
      { p: 'high', emoji: '⚠️', n: T.brErr, d: 'خطأ من الفروع في شيتات التحويلات (' + P(T.brErrRate) + ' من التحويلات)', tab: 'transfers' },
      { p: 'high', emoji: '🧭', n: T.respErr + Z.err, d: 'خطأ مسجَّل على مسؤولي التعديل (تحويلات ' + N(T.respErr) + ' + زونات ' + N(Z.err) + ')', tab: 'zones' },
      { p: 'med', emoji: '📐', n: W.volMismatch, d: 'وزن حجمي مسجَّل يختلف عن الأبعاد بأكثر من ' + WZ.RULES.VOL_TOLERANCE_KG + ' كجم', tab: 'weights' },
      { p: 'med', emoji: '🕒', n: C.unrecorded, d: 'يوم/فرع مضى دون تسجيل حالة إرسال الشيت', tab: 'compliance' },
      { p: 'med', emoji: '🔁', n: W.dupRows, d: 'سجل وزن لشحنة عُدّلت أكثر من مرة', tab: 'quality' },
      { p: 'low', emoji: '🛡️', n: crit.length, d: 'ملاحظة جودة بيانات حرجة/مرتفعة على الشيت', tab: 'quality' }
    ].filter(function (a) { return a.n > 0; });
    var tier = { crit: 'حرج', high: 'تحذير', med: 'تحذير', low: 'معلومة' };
    $('ovAlerts').innerHTML = list.length ? list.map(function (a) {
      return '<div class="alert-card ' + a.p + '" data-tab="' + a.tab + '"><div class="alert-top"><span class="alert-emoji">' + a.emoji + '</span><span class="alert-priority ' + a.p + '">' + tier[a.p] + '</span></div>' +
        '<div class="alert-desc">' + esc(a.d) + '</div><div class="alert-bottom"><span class="alert-count num">' + N(a.n) + '</span><span class="alert-cta">عرض التفاصيل <i class="fa-solid fa-arrow-left"></i></span></div></div>';
    }).join('') : '<div class="alert-empty">لا توجد تنبيهات نشطة ضمن عوامل التصفية الحالية</div>';
    $('ovAlerts').querySelectorAll('.alert-card').forEach(function (c) { c.addEventListener('click', function () { setTab(c.dataset.tab); }); });
  }

  function renderInsights() {
    var s = state.sub, W = s.W, list = [];
    var byB = WZ.weightsBy(s.weights, function (r) { return r.br; });
    if (byB.length >= 3) {
      var two = byB[0].count + byB[1].count, sh = two / W.count;
      if (sh >= 0.5) list.push({ p: 'medium', t: 'تركّز تعديلات الأوزان',
        problem: '<b>' + esc(byB[0].key) + '</b> و<b>' + esc(byB[1].key) + '</b> يمثلان <b>' + P(sh) + '</b> من تعديلات الأوزان (' + N(two) + ' من ' + N(W.count) + ').',
        impact: 'قيمة الوزن الزائد من الفرعين <b>' + N(byB[0].value + byB[1].value) + '</b> ج.م من إجمالي <b>' + N(W.value) + '</b> ج.م.',
        action: 'مراجعة آلية وزن وقياس الشحنات عند الاستلام مع أكثر الراسلين تكرارًا في الفرعين.' });
    }
    var byP = WZ.weightsBy(s.weights, function (r) { return r.person; });
    if (byP.length && byP[0].count / W.count >= 0.8 && W.count >= 20) list.push({ p: 'medium', t: 'اعتماد على مراجع واحد',
      problem: '<b>' + esc(byP[0].key) + '</b> راجع <b>' + P(byP[0].count / W.count) + '</b> من تعديلات الأوزان (' + N(byP[0].count) + ' سجل).',
      impact: 'استمرارية العمل وجودة المراجعة مرتبطتان بموظف واحد.',
      action: 'توزيع المراجعة أو تعيين بديل مدرَّب، مع مراجعة عيّنة دورية من طرف ثانٍ.' });
    var sr = selfReview(s);
    if (sr.tRows + sr.zRows > 0) list.push({ p: 'high', t: 'المنفّذ هو نفسه المراجع',
      problem: 'في <b>' + N(sr.tRows) + '</b> سجل تحويلات (' + N(sr.tCount) + ' تحويل) و<b>' + N(sr.zRows) + '</b> تعديل زون، مسؤول التعديل هو نفسه المدوَّن في خانة «مراجعه» (' + esc(sr.names.join('، ')) + ').',
      impact: 'غياب الفصل بين التنفيذ والمراجعة؛ الأخطاء في هذه السجلات لا يرصدها طرف مستقل.',
      action: 'إسناد مراجعة هذه السجلات لموظف آخر، أو مراجعة عيّنة منها من إدارة المراجعة.' });
    var tb = WZ.transfersBy(s.transfers, function (r) { return r.br; }).filter(function (b) { return b.count >= 10 && b.brErrRate >= 0.1; }).sort(function (a, b) { return b.brErrRate - a.brErrRate; });
    if (tb.length) list.push({ p: 'high', t: 'أخطاء فرع مرتفعة في شيت التحويلات',
      problem: tb.map(function (b) { return '<b>' + esc(b.key) + '</b>: ' + N(b.brErr) + ' خطأ من ' + N(b.count) + ' تحويل (<b>' + P(b.brErrRate) + '</b>)'; }).join(' · ') + '.',
      impact: 'كل خطأ في الشيت يعني تعديلًا خاطئًا أو إعادة عمل قبل طباعة البوليصة.',
      action: 'إعادة شرح نموذج شيت التحويلات لمسؤول الفرع ومتابعة نسبة الخطأ يوميًا.' });
    var cb = WZ.complianceBy(s.compliance, function (r) { return r.br; }).filter(function (b) { return b.notSent > 0; }).sort(function (a, b) { return b.notSent - a.notSent; });
    if (cb.length) list.push({ p: 'high', t: 'فروع لم ترسل شيت التحويلات',
      problem: cb.map(function (b) { return '<b>' + esc(b.key) + '</b>: ' + N(b.notSent) + ' مرة (التزام ' + P(b.rate) + ')'; }).join(' · ') + '.',
      impact: 'تحويلات ذلك اليوم لا تُعدَّل مركزيًا وفق الآلية المُبلَّغة للأفرع.',
      action: 'تنبيه مدير الفرع كتابيًا وتحديد موعد يومي ثابت لإرسال الشيت.' });
    if (W.volMismatch) list.push({ p: 'medium', t: 'فروقات بين الوزن المسجَّل والأبعاد',
      problem: '<b>' + N(W.volMismatch) + '</b> سجل وزن حجمي (' + P(W.volMismatch / W.volChecked) + ' من القابل للتحقق): <b>' + N(W.volOver) + '</b> مسجَّل أعلى من المحسوب و<b>' + N(W.volUnder) + '</b> أقل.',
      impact: 'وزن أعلى من المحسوب يعني تحميل العميل قيمة زائدة؛ والأقل يعني قيمة غير محصَّلة.',
      action: 'مراجعة السجلات في تبويب «تعديل الأوزان» واعتماد قاعدة تقريب مكتوبة.' });
    var ze = s.zoneEdits.filter(function (r) { return r.err >= 3; });
    if (ze.length) list.push({ p: 'medium', t: 'أخطاء متعددة في تعديل زون واحد',
      problem: ze.map(function (r) { return '<b>' + N(r.err) + '</b> أخطاء في تعديل زون المندوب ' + esc(r.courier) + ' (' + esc(r.br) + '، ' + D(r.d) + ') — المسؤول: ' + esc(r.person); }).join(' · ') + '.',
      impact: 'شحنات المندوب تُحتسب على زون خاطئ حتى التصحيح.',
      action: 'مراجعة شحنات المندوب في ذلك اليوم والتأكد من تصحيح الزون.' });
    var pl = { critical: 'حرج', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' };
    $('ovInsights').innerHTML = list.length ? '<div class="insight-cards-v2">' + list.map(function (i) {
      return '<div class="insight-card-v2"><div class="insight-card-v2-head"><b>' + esc(i.t) + '</b><span class="insight-priority ' + i.p + '">' + pl[i.p] + '</span></div>' +
        '<div class="insight-card-v2-row"><span class="k">الملاحظة</span><span class="v">' + i.problem + '</span></div>' +
        '<div class="insight-card-v2-row"><span class="k">الأثر</span><span class="v">' + i.impact + '</span></div>' +
        '<div class="insight-card-v2-row"><span class="k">إجراء مقترح</span><span class="v">' + i.action + '</span></div></div>';
    }).join('') + '</div>' : '<div class="wz-empty">لا توجد بيانات كافية ضمن عوامل التصفية الحالية لعرض رؤى.</div>';
  }

  function renderTop() {
    var s = state.sub;
    function rows(list, fmt) { return list.length ? list.slice(0, 5).map(function (x, i) { return '<div class="tp-row"><span class="tp-rank">' + (i + 1) + '</span><span class="tp-name" title="' + esc(x.key) + '">' + esc(x.key) + '</span><span class="tp-val">' + fmt(x) + '</span></div>'; }).join('') : '<div class="tp-empty">لا توجد بيانات كافية</div>'; }
    var byB = WZ.weightsBy(s.weights, function (r) { return r.br; });
    var tb = WZ.transfersBy(s.transfers, function (r) { return r.br; }).filter(function (b) { return b.count > 0; }).sort(function (a, b) { return b.brErrRate - a.brErrRate; });
    var cb = WZ.complianceBy(s.compliance, function (r) { return r.br; }).filter(function (b) { return b.due > 0; }).sort(function (a, b) { return a.rate - b.rate || b.notSent - a.notSent; });
    $('ovTop').innerHTML =
      '<div class="tp-card"><h5><i class="fa-solid fa-weight-scale"></i> أعلى الفروع في عدد تعديلات الأوزان</h5>' + rows(byB, function (x) { return N(x.count) + ' (' + P(x.share) + ')'; }) + '</div>' +
      '<div class="tp-card"><h5><i class="fa-solid fa-coins"></i> أعلى الفروع في قيمة الوزن الزائد</h5>' + rows(byB.slice().sort(function (a, b) { return b.value - a.value; }), function (x) { return N(x.value) + ' ج.م'; }) + '</div>' +
      '<div class="tp-card"><h5><i class="fa-solid fa-triangle-exclamation"></i> أعلى نسبة أخطاء فرع في التحويلات</h5>' + rows(tb, function (x) { return P(x.brErrRate) + ' (' + N(x.brErr) + '/' + N(x.count) + ')'; }) + '</div>' +
      '<div class="tp-card"><h5><i class="fa-solid fa-clipboard-check"></i> أقل الفروع التزامًا بإرسال الشيت</h5>' + rows(cb, function (x) { return P(x.rate) + ' (' + N(x.notSent) + ' لم يرسل)'; }) + '</div>';
  }

  /* ---------- رسوم مشتركة ---------- */
  function dailyChart(id, rows) {
    var g = WZ.groupBy(rows.filter(function (r) { return r.d; }), function (r) { return r.d; }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    chart(id, { data: { labels: g.map(function (x) { return DS(x.key); }), datasets: [
      { type: 'bar', label: 'عدد التعديلات', data: g.map(function (x) { return x.rows.length; }), backgroundColor: C1(), borderRadius: 3, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'قيمة الوزن الزائد (ج.م)', data: g.map(function (x) { return WZ.sum(x.rows, function (r) { return r.price; }); }), borderColor: C2(), backgroundColor: C2(), tension: .3, pointRadius: 2, yAxisID: 'y1', order: 1 }
    ] }, options: baseOpts(function (o) { dualAxis(o, 'ج.م'); o.scales.x.ticks.maxRotation = 60; o.scales.x.ticks.autoSkip = true; }) });
  }
  function branchChart(id, rows, top) {
    var b = WZ.weightsBy(rows, function (r) { return r.br; }); if (top) b = b.slice(0, top);
    chart(id, { data: { labels: b.map(function (x) { return x.key; }), datasets: [
      { type: 'bar', label: 'عدد التعديلات', data: b.map(function (x) { return x.count; }), backgroundColor: C1(), borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'قيمة الوزن الزائد (ج.م)', data: b.map(function (x) { return x.value; }), borderColor: C2(), backgroundColor: C2(), pointRadius: 4, showLine: false, yAxisID: 'y1', order: 1 }
    ] }, options: baseOpts(function (o) { dualAxis(o, 'ج.م'); o.onClick = function (e, els) { if (els.length) toggleBranch(b[els[0].index].key); }; o.onHover = function (e, els) { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }; }) });
  }

  /* ---------- تعديل الأوزان ---------- */
  function renderWeights() {
    var s = state.sub, W = s.W, rows = s.weights;
    $('wKpis').innerHTML =
      stub('brand', 'weight-scale', 'إجمالي التعديلات', N(W.count), '', N(W.shipments) + ' شحنة مختلفة' + (W.dupRows ? ' · ' + N(W.dupRows) + ' سجل لشحنات عُدّلت أكثر من مرة' : '')) +
      stub('success', 'coins', 'قيمة الوزن الزائد (ج.م)', N(W.value), '', 'مجموع عمود «سعر الوزن الزائد»') +
      stub('in-progress', 'hand-holding-dollar', 'المستحق للمناديب (ج.م)', N(W.courierShare), '', 'القيمة × نسبة «ما يصرف للمندوب» لكل سجل') +
      stub('in-progress', 'calculator', 'متوسط التعديل', N1(W.avgValue) + ' ج.م', N1(W.avgKg) + ' كجم', 'متوسط القيمة ومتوسط «عدد الكيلوات» للسجل') +
      stub('in-progress', 'calendar-day', 'المتوسط اليومي', N1(W.dailyAvg), '', 'تعديل لكل يوم به تسجيل (' + N(W.days) + ' يوم)') +
      stub(W.volMismatch ? 'under-action' : 'success', 'ruler-combined', 'مطابقة الوزن الحجمي للأبعاد', P(W.volMatchRate), N(W.volMismatch) + ' فرق', N(W.volChecked) + ' سجل قابل للتحقق · ' + N(W.volUnparsed) + ' بدون أبعاد قابلة للحساب');
    $('wNote').innerHTML = '<b>تعريفات:</b> «قيمة الوزن الزائد» = مجموع عمود «سعر الوزن الزائد». «المستحق للمناديب» = القيمة × النسبة في عمود «ما يصرف للمندوب» <b>(افتراض: النسبة تُطبَّق على قيمة الوزن الزائد)</b>. «مطابقة الوزن الحجمي» = إعادة حساب (طول×عرض×ارتفاع÷5000) من عمود الأبعاد ومقارنتها بـ«عدد الكيلوات» بسماحية ±' + WZ.RULES.VOL_TOLERANCE_KG + ' كجم <b>(سماحية مقترحة لحين اعتماد قاعدة تقريب)</b>.' +
      (state.model.mirrors.length ? ' تم استبعاد <b>' + N(state.model.mirrors.length) + '</b> سجل مكرر حرفيًا بين شيتين من كل الإجماليات (التفاصيل في «جودة البيانات»).' : '');

    branchChart('chWBranch', rows);
    dailyChart('chWDaily', rows);
    var bins = [[0, 3, '≤ 3'], [4, 5, '4–5'], [6, 7, '6–7'], [8, 10, '8–10'], [11, 15, '11–15'], [16, 25, '16–25'], [26, 1e9, '> 25']];
    chart('chWKg', { type: 'bar', data: { labels: bins.map(function (b) { return b[2]; }), datasets: [{ label: 'عدد التعديلات', data: bins.map(function (b) { return rows.filter(function (r) { return r.kg != null && r.kg >= b[0] && r.kg <= b[1]; }).length; }), backgroundColor: C1(), borderRadius: 4 }] }, options: baseOpts(function (o) { o.plugins.legend.display = false; }) });
    var re = WZ.weightsBy(rows, function (r) { return r.reason; });
    chart('chWReason', { type: 'doughnut', data: { labels: re.map(function (x) { return x.key + ' — ' + N(x.count) + ' (' + P(x.share) + ')'; }), datasets: [{ data: re.map(function (x) { return x.count; }), backgroundColor: [C1(), C2(), css('--gray-400') || '#94A3B8', css('--gray-300')], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', rtl: true, labels: { color: css('--chart-label'), font: { family: 'Cairo', size: 12 } } } } } });
    var pe = WZ.weightsBy(rows, function (r) { return r.person; });
    chart('chWPerson', { type: 'bar', data: { labels: pe.map(function (x) { return x.key; }), datasets: [{ label: 'عدد السجلات', data: pe.map(function (x) { return x.count; }), backgroundColor: C1(), borderRadius: 4 }] }, options: baseOpts(function (o) { o.indexAxis = 'y'; o.plugins.legend.display = false; o.scales.x.grid.display = true; o.scales.y.grid.display = false; o.scales.x.beginAtZero = true; }) });

    /* مقارنة الأشهر */
    var months = WZ.groupBy(rows.filter(function (r) { return r.month; }), function (r) { return r.month; }).sort(function (a, b) { return a.key < b.key ? -1 : 1; })
      .map(function (g) { var st = WZ.weightStats(g.rows); st.key = g.key; var d = g.rows.map(function (r) { return r.d; }).sort(); st.from = d[0]; st.to = d[d.length - 1]; return st; });
    months.forEach(function (mth, i) { var prev = months[i - 1]; mth.chg = prev && prev.dailyAvg ? (mth.dailyAvg - prev.dailyAvg) / prev.dailyAvg : null; });
    table('tblWMonths', [
      { k: 'key', t: 'الشهر', f: function (r) { return esc(WZ.monthLabel(r.key)); } },
      { k: 'from', t: 'الفترة المسجَّلة', f: function (r) { return DS(r.from) + ' – ' + DS(r.to); } },
      { k: 'days', t: 'أيام التسجيل', num: true, f: function (r) { return N(r.days); } },
      { k: 'count', t: 'التعديلات', num: true, f: function (r) { return N(r.count); } },
      { k: 'dailyAvg', t: 'متوسط يومي', num: true, f: function (r) { return N1(r.dailyAvg); } },
      { k: 'chg', t: 'تغيّر المتوسط اليومي', num: true, f: function (r) { return r.chg == null ? '—' : (r.chg > 0 ? '+' : '') + (r.chg * 100).toFixed(1) + '%'; } },
      { k: 'value', t: 'قيمة الوزن الزائد (ج.م)', num: true, f: function (r) { return N(r.value); } },
      { k: 'avgValue', t: 'متوسط القيمة (ج.م)', num: true, f: function (r) { return N1(r.avgValue); } },
      { k: 'avgKg', t: 'متوسط الوزن (كجم)', num: true, f: function (r) { return N1(r.avgKg); } },
      { k: 'volShare', t: 'نسبة الحجمي', num: true, f: function (r) { return P(r.volShare); } },
      { k: 'volMatchRate', t: 'مطابقة الأبعاد', num: true, f: function (r) { return P(r.volMatchRate); } }
    ], months, { pageSize: 0, sort: 'key', dir: 1 });
    $('wMonthSub').textContent = 'الأشهر غير مكتملة التغطية؛ قارن بالمتوسط اليومي لا بالإجمالي';

    var byB = WZ.weightsBy(rows, function (r) { return r.br; }), maxC = Math.max.apply(null, byB.map(function (b) { return b.count; }).concat([1]));
    table('tblWBranch', [
      { k: 'key', t: 'الفرع' },
      { k: 'count', t: 'التعديلات', num: true, f: function (r) { return '<span class="wz-bar" style="width:' + Math.round(r.count / maxC * 90) + 'px"></span>' + N(r.count); } },
      { k: 'share', t: 'النسبة', num: true, f: function (r) { return P(r.share); } },
      { k: 'value', t: 'قيمة الوزن الزائد (ج.م)', num: true, f: function (r) { return N(r.value); } },
      { k: 'avgValue', t: 'متوسط القيمة', num: true, f: function (r) { return N1(r.avgValue); } },
      { k: 'avgKg', t: 'متوسط الوزن (كجم)', num: true, f: function (r) { return N1(r.avgKg); } },
      { k: 'volShare', t: 'نسبة الحجمي', num: true, f: function (r) { return P(r.volShare); } },
      { k: 'volMismatch', t: 'فروقات الأبعاد', num: true, f: function (r) { return r.volChecked ? N(r.volMismatch) + ' / ' + N(r.volChecked) : '—'; } },
      { k: 'dailyAvg', t: 'متوسط يومي', num: true, f: function (r) { return N1(r.dailyAvg); } }
    ], byB, { pageSize: 0, sort: 'count', total: { count: N(W.count), share: '100%', value: N(W.value), avgValue: N1(W.avgValue), avgKg: N1(W.avgKg), volShare: P(W.volShare), volMismatch: N(W.volMismatch) + ' / ' + N(W.volChecked), dailyAvg: N1(W.dailyAvg) } });

    var mm = rows.filter(function (r) { return r.volFlag === 'over' || r.volFlag === 'under'; });
    $('wVolSub').textContent = N(mm.length) + ' سجل · الفرق = المسجَّل − المحسوب من الأبعاد';
    table('tblWVol', logCols(true), mm, { sort: 'volDiff', pageSize: 15, empty: 'لا توجد فروقات تتجاوز السماحية ضمن التصفية الحالية' });
    table('tblWLog', logCols(false), rows, { sort: 'd', pageSize: 25 });
  }
  function logCols(vol) {
    var c = [
      { k: 'd', t: 'التاريخ', num: true, f: function (r) { return D(r.d); } },
      { k: 'br', t: 'الفرع' },
      { k: 'code', t: 'كود الشحنة', cls: 'mono', f: function (r) { return esc(r.code) + (r.dup ? ' ' + badge('pending', 'clone', 'مكرر') : ''); } },
      { k: 'reason', t: 'السبب' },
      { k: 'person', t: 'المراجع' },
      { k: 'kg', t: 'الكيلوات', num: true, f: function (r) { return N(r.kg); } }
    ];
    if (vol) c.push({ k: 'vol', t: 'المحسوب من الأبعاد', num: true, f: function (r) { return r.vol == null ? '—' : r.vol.toFixed(2); } },
      { k: 'volDiff', t: 'الفرق (كجم)', num: true, sv: function (r) { return Math.abs(r.volDiff); }, f: function (r) { return (r.volDiff > 0 ? '+' : '') + r.volDiff.toFixed(2) + ' ' + (r.volDiff > 0 ? badge('rejected', 'arrow-up', 'أعلى') : badge('pending', 'arrow-down', 'أقل')); } });
    c.push({ k: 'price', t: 'قيمة الوزن الزائد', num: true, f: function (r) { return N(r.price); } });
    if (!vol) c.push({ k: 'courierShare', t: 'للمندوب', num: true, f: function (r) { return r.courierShare == null ? '—' : N1(r.courierShare); } });
    c.push({ k: 'dims', t: 'الأبعاد / السند', cls: 'wrap', f: function (r) { return esc(r.dims || '—') + (r.note ? '<br><small>' + esc(r.note) + '</small>' : ''); } });
    return c;
  }

  /* ---------- تحويلات الأفرع ---------- */
  function renderTransfers() {
    var s = state.sub, T = s.T, rec = s.transfers.filter(function (r) { return r.recorded; });
    $('tKpis').innerHTML =
      stub('brand', 'right-left', 'إجمالي التحويلات', N(T.count), '', N(T.days) + ' يوم مسجَّل · ' + N(T.branches) + ' فرع به تحويلات') +
      stub(T.brErr ? 'under-action' : 'success', 'building-circle-exclamation', 'أخطاء الفروع', N(T.brErr), P(T.brErrRate), 'أخطاء الفرع في شيت التحويلات ÷ عدد التحويلات') +
      stub(T.respErr ? 'under-action' : 'success', 'user-xmark', 'أخطاء مسؤول التحويل', N(T.respErr), P(T.respErrRate), 'أخطاء المسؤول ÷ عدد التحويلات') +
      stub('in-progress', 'calculator', 'متوسط التحويلات اليومي', N1(WZ.rate(T.count, T.days)), '', 'إجمالي التحويلات ÷ الأيام المسجَّلة') +
      stub('in-progress', 'circle-check', 'تحويلات بلا أخطاء مسجَّلة', P(T.count ? 1 - (T.brErr + T.respErr) / T.count : null), '', 'بافتراض أن كل خطأ يخص تحويلًا واحدًا') +
      stub(T.pendingRows ? 'under-action' : 'success', 'hourglass-half', 'صفوف لم تُسجَّل بعد', N(T.pendingRows), '', 'صفوف (يوم/فرع) موجودة في الشيت بدون أرقام');
    $('tNote').innerHTML = '<b>تغطية البيانات:</b> سجل التحويلات يحتوي ' + N(T.days) + ' يوم مسجَّل فقط حتى الآن؛ النسب استرشادية ولا تصلح بعدُ للحكم على أداء فرع.';

    var byB = WZ.transfersBy(rec, function (r) { return r.br; }).filter(function (b) { return b.count > 0; });
    chart('chTBranch', { data: { labels: byB.map(function (x) { return x.key; }), datasets: [
      { type: 'bar', label: 'عدد التحويلات', data: byB.map(function (x) { return x.count; }), backgroundColor: C1(), borderRadius: 4, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'نسبة أخطاء الفرع %', data: byB.map(function (x) { return +(x.brErrRate * 100).toFixed(1); }), borderColor: CRED(), backgroundColor: CRED(), pointRadius: 4, showLine: false, yAxisID: 'y1', order: 1 }
    ] }, options: baseOpts(function (o) { dualAxis(o, '%'); }) });
    var byD = WZ.transfersBy(rec, function (r) { return r.d; }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    chart('chTDaily', { type: 'bar', data: { labels: byD.map(function (x) { return DS(x.key); }), datasets: [
      { label: 'أخطاء الفروع', data: byD.map(function (x) { return x.brErr; }), backgroundColor: CAMB(), borderRadius: 4 },
      { label: 'أخطاء مسؤول التحويل', data: byD.map(function (x) { return x.respErr; }), backgroundColor: CRED(), borderRadius: 4 }
    ] }, options: baseOpts() });

    var cols = function (first) { return [
      { k: 'key', t: first },
      { k: 'count', t: 'التحويلات', num: true, f: function (r) { return N(r.count); } },
      { k: 'days', t: 'أيام', num: true, f: function (r) { return N(r.days); } },
      { k: 'brErr', t: 'أخطاء الفرع', num: true, f: function (r) { return N(r.brErr); } },
      { k: 'brErrRate', t: 'نسبة أخطاء الفرع', num: true, f: function (r) { return P(r.brErrRate); } },
      { k: 'respErr', t: 'أخطاء المسؤول', num: true, f: function (r) { return N(r.respErr); } },
      { k: 'respErrRate', t: 'نسبة أخطاء المسؤول', num: true, f: function (r) { return P(r.respErrRate); } }
    ]; };
    var tot = { count: N(T.count), days: N(T.days), brErr: N(T.brErr), brErrRate: P(T.brErrRate), respErr: N(T.respErr), respErrRate: P(T.respErrRate) };
    table('tblTBranch', cols('الفرع'), WZ.transfersBy(rec, function (r) { return r.br; }), { pageSize: 0, sort: 'count', total: tot });
    table('tblTPerson', cols('مسؤول التحويل'), WZ.transfersBy(rec.filter(function (r) { return r.person; }), function (r) { return r.person; }), { pageSize: 0, sort: 'count' });
    table('tblTLog', [
      { k: 'd', t: 'التاريخ', num: true, f: function (r) { return D(r.d) + (r.dateSwapped ? ' ' + badge('pending', 'calendar-xmark', 'تاريخ مصحَّح') : ''); } },
      { k: 'br', t: 'الفرع' },
      { k: 'count', t: 'عدد التحويلات', num: true, f: function (r) { return N(r.count); } },
      { k: 'brErr', t: 'أخطاء الفرع', num: true, f: function (r) { return N(r.brErr); } },
      { k: 'person', t: 'مسؤول التحويل', f: function (r) { return esc(r.person || '—'); } },
      { k: 'rev', t: 'مراجعه', f: function (r) { return esc(r.rev || '—') + (r.person && r.person === r.rev && r.count > 0 ? ' ' + badge('neutral', 'user-check', 'نفس المنفّذ') : ''); } },
      { k: 'respErr', t: 'أخطاء المسؤول', num: true, f: function (r) { return N(r.respErr); } }
    ], rec, { sort: 'd', pageSize: 25 });
  }

  /* ---------- زونات المناديب ---------- */
  function renderZones() {
    var s = state.sub, Z = s.Z, rows = s.zoneEdits;
    $('zKpis').innerHTML =
      stub('brand', 'map-location-dot', 'تعديلات الزونات', N(Z.count), '', N(Z.days) + ' يوم مسجَّل · متوسط ' + N1(WZ.rate(Z.count, Z.days)) + ' تعديل/يوم') +
      stub('in-progress', 'motorcycle', 'مناديب عُدّل زونهم', N(Z.couriers), '', 'عدد المناديب المختلفين (فرع + اسم)') +
      stub('in-progress', 'location-dot', 'زونات مختلفة', N(Z.zones), '', 'عدد الزونات التي حُوِّل إليها مناديب') +
      stub(Z.err ? 'under-action' : 'success', 'user-xmark', 'أخطاء مسؤول التعديل', N(Z.err), '', 'مجموع عمود «اخطاء مسئول التعديل»') +
      stub(Z.errRows ? 'under-action' : 'success', 'list-check', 'سجلات بها أخطاء', N(Z.errRows), P(Z.errRowRate), 'سجلات بها خطأ واحد على الأقل ÷ إجمالي السجلات') +
      stub('in-progress', 'book', 'القائمة المعتمدة', N(s.zonesMaster.length), '', 'مندوب/قاعدة في تبويب «الزونات»');
    $('zNote').innerHTML = '<b>ملاحظة:</b> الصف الواحد قد يحمل أكثر من خطأ؛ لذلك يُعرض عدد الأخطاء وعدد السجلات التي بها أخطاء كلٌّ على حدة. سجل التعديلات يغطي ' + N(Z.days) + ' يوم فقط حتى الآن.';
    var byB = WZ.zonesBy(rows, function (r) { return r.br; });
    chart('chZBranch', { type: 'bar', data: { labels: byB.map(function (x) { return x.key; }), datasets: [
      { label: 'عدد التعديلات', data: byB.map(function (x) { return x.count; }), backgroundColor: C1(), borderRadius: 4 },
      { label: 'أخطاء مسؤول التعديل', data: byB.map(function (x) { return x.err; }), backgroundColor: CRED(), borderRadius: 4 }
    ] }, options: baseOpts() });
    var byZ = WZ.zonesBy(rows, function (r) { return r.zone || MISSING; }).slice(0, 12);
    chart('chZZone', { type: 'bar', data: { labels: byZ.map(function (x) { return x.key; }), datasets: [{ label: 'عدد التعديلات', data: byZ.map(function (x) { return x.count; }), backgroundColor: C2(), borderRadius: 4 }] }, options: baseOpts(function (o) { o.indexAxis = 'y'; o.plugins.legend.display = false; o.scales.x.grid.display = true; o.scales.y.grid.display = false; }) });
    table('tblZPerson', [
      { k: 'key', t: 'مسؤول التعديل' },
      { k: 'count', t: 'التعديلات', num: true, f: function (r) { return N(r.count); } },
      { k: 'couriers', t: 'مناديب', num: true, f: function (r) { return N(r.couriers); } },
      { k: 'err', t: 'عدد الأخطاء', num: true, f: function (r) { return N(r.err); } },
      { k: 'errRows', t: 'سجلات بها أخطاء', num: true, f: function (r) { return N(r.errRows) + ' (' + P(r.errRowRate) + ')'; } }
    ], WZ.zonesBy(rows, function (r) { return r.person; }), { pageSize: 0, sort: 'count', total: { count: N(Z.count), couriers: N(Z.couriers), err: N(Z.err), errRows: N(Z.errRows) + ' (' + P(Z.errRowRate) + ')' } });
    table('tblZLog', [
      { k: 'd', t: 'التاريخ', num: true, f: function (r) { return D(r.d) + (r.dateSwapped ? ' ' + badge('pending', 'calendar-xmark', 'تاريخ مصحَّح') : ''); } },
      { k: 'br', t: 'الفرع' }, { k: 'courier', t: 'المندوب' },
      { k: 'zone', t: 'الزون', f: function (r) { return esc(r.zone || '—') + (r.zoneWasDate ? ' ' + badge('neutral', 'pen', 'حُوِّل من تاريخ') : ''); } },
      { k: 'person', t: 'مسؤول التعديل' },
      { k: 'rev', t: 'مراجعه', f: function (r) { return esc(r.rev || '—') + (r.person === r.rev ? ' ' + badge('neutral', 'user-check', 'نفس المنفّذ') : ''); } },
      { k: 'err', t: 'الأخطاء', num: true, f: function (r) { return r.err ? badge('rejected', 'triangle-exclamation', N(r.err)) : '0'; } }
    ], rows, { sort: 'd', pageSize: 25 });
    table('tblZMaster', [
      { k: 'n', t: 'م', num: true }, { k: 'region', t: 'المنطقة' }, { k: 'br', t: 'الفرع' }, { k: 'courier', t: 'المندوب' },
      { k: 'scope', t: 'حالة الشحنات' }, { k: 'what', t: 'ما يتم تحويله', cls: 'wrap' }, { k: 'to', t: 'الزون يحوَّل إلى', cls: 'wrap' }, { k: 'extra', t: 'ملاحظة' }
    ], s.zonesMaster, { sort: 'n', dir: 1, pageSize: 25 });
  }

  /* ---------- التزام الفروع ---------- */
  function renderCompliance() {
    var s = state.sub, C = s.C, rows = s.compliance;
    var tracked = WZ.uniq(rows.filter(function (r) { return r.state === 'sent' || r.state === 'notSent'; }), function (r) { return r.d; }).length;
    var full = WZ.complianceBy(rows, function (r) { return r.br; }).filter(function (b) { return b.due > 0; });
    $('cKpis').innerHTML =
      stub(C.notSent ? 'under-action' : 'success', 'clipboard-check', 'نسبة الالتزام', P(C.rate), '', N(C.sent) + ' من ' + N(C.due) + ' (يوم × فرع) مستحق') +
      stub(C.notSent ? 'violation' : 'success', 'ban', 'لم يرسل', N(C.notSent), '', 'مرات عدم إرسال الشيت') +
      stub(C.unrecorded ? 'under-action' : 'success', 'circle-question', 'غير مسجَّل', N(C.unrecorded), '', 'أيام مضت بخانة فارغة (خارج مقام النسبة)') +
      stub('in-progress', 'calendar-days', 'أيام المتابعة', N(tracked), '', 'أيام بها حالة مسجَّلة لفرع واحد على الأقل') +
      stub('success', 'award', 'فروع بالتزام 100%', N(full.filter(function (b) { return b.notSent === 0; }).length) + ' / ' + N(full.length), '', 'من الفروع التي لها أيام مستحقة') +
      stub('in-progress', 'slash', 'غير منطبق «/»', N(C.na), '', 'إجازات أو فروع خارج الآلية (مثل الهرم)');

    var legend = '<div class="heat-legend"><span><i class="h-sent"></i> تم الإرسال والتعديل</span><span><i class="h-notSent"></i> لم يرسل</span><span><i class="h-unrecorded"></i> غير مسجَّل</span><span><i class="h-na"></i> غير منطبق «/»</span><span><i class="h-none" style="border:1px dashed var(--line)"></i> لم يحن / قبل بدء المتابعة</span></div>';
    var sym = { sent: '✓', notSent: '✕', na: '/', unrecorded: '؟' };
    $('cGrids').innerHTML = WZ.groupBy(rows, function (r) { return r.month; }).sort(function (a, b) { return a.key < b.key ? 1 : -1; }).map(function (g) {
      var days = WZ.uniq(g.rows, function (r) { return r.d; }).sort(), brs = WZ.uniq(g.rows, function (r) { return r.br; }), map = {};
      g.rows.forEach(function (r) { map[r.br + '|' + r.d] = r; });
      var st = WZ.complianceStats(g.rows);
      return '<section class="table-panel"><div class="table-head-bar"><h3>' + esc(WZ.monthLabel(g.key)) + '</h3><div class="panel-sub" style="margin:0">الالتزام ' + P(st.rate) + ' · لم يرسل ' + N(st.notSent) + ' · غير مسجَّل ' + N(st.unrecorded) + '</div></div>' +
        '<div class="heat-wrap"><table class="heat"><thead><tr><th class="br"></th>' + days.map(function (d) { return '<th>' + (+d.slice(8, 10)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        brs.map(function (b) { return '<tr><th class="br">' + esc(b) + '</th>' + days.map(function (d) { var r = map[b + '|' + d] || { state: 'none' }; return '<td class="h-' + r.state + '" title="' + esc(b + ' — ' + D(d) + ' — ' + (r.raw || 'فارغ')) + '">' + (sym[r.state] || '') + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>' + legend + '</section>';
    }).join('') || '<div class="wz-empty">لا توجد بيانات التزام ضمن التصفية الحالية</div>';

    table('tblCBranch', [
      { k: 'key', t: 'الفرع' },
      { k: 'due', t: 'أيام مستحقة', num: true, f: function (r) { return N(r.due); } },
      { k: 'sent', t: 'تم الإرسال', num: true, f: function (r) { return N(r.sent); } },
      { k: 'notSent', t: 'لم يرسل', num: true, f: function (r) { return N(r.notSent); } },
      { k: 'rate', t: 'نسبة الالتزام', num: true, f: function (r) { return P(r.rate); } },
      { k: 'unrecorded', t: 'غير مسجَّل', num: true, f: function (r) { return N(r.unrecorded); } },
      { k: 'na', t: 'غير منطبق', num: true, f: function (r) { return N(r.na); } },
      { k: 'st', t: 'الحالة', nosort: true, f: function (r) { return !r.due ? badge('neutral', 'minus', 'خارج الآلية') : r.notSent ? badge('rejected', 'triangle-exclamation', 'يحتاج متابعة') : badge('accepted', 'circle-check', 'ملتزم'); } }
    ], WZ.complianceBy(rows, function (r) { return r.br; }), { pageSize: 0, sort: 'notSent', total: { due: N(C.due), sent: N(C.sent), notSent: N(C.notSent), rate: P(C.rate), unrecorded: N(C.unrecorded), na: N(C.na) } });
    table('tblCMiss', [
      { k: 'd', t: 'التاريخ', num: true, f: function (r) { return D(r.d); } }, { k: 'br', t: 'الفرع' },
      { k: 'state', t: 'الحالة', f: function (r) { return r.state === 'notSent' ? badge('rejected', 'ban', 'لم يرسل') : badge('pending', 'circle-question', 'غير مسجَّل'); } }
    ], rows.filter(function (r) { return r.state === 'notSent' || r.state === 'unrecorded'; }), { sort: 'd', pageSize: 0, empty: 'لا توجد حالات عدم إرسال أو أيام غير مسجَّلة' });
  }

  /* ---------- جودة البيانات ---------- */
  function renderQuality() {
    var q = state.model.quality, by = { critical: 0, high: 0, medium: 0, low: 0 };
    q.forEach(function (x) { by[x.sev]++; });
    var m = state.model;
    $('qKpis').innerHTML =
      stub(by.critical ? 'violation' : 'success', 'circle-exclamation', 'ملاحظات حرجة', N(by.critical), '', 'تؤثر على صحة الإجماليات') +
      stub(by.high ? 'under-action' : 'success', 'triangle-exclamation', 'ملاحظات مرتفعة', N(by.high), '', 'تمس قيمة مالية أو نسب السجل') +
      stub('in-progress', 'circle-info', 'ملاحظات متوسطة', N(by.medium), '', 'قد تشوّه التوزيعات') +
      stub('in-progress', 'pen', 'ملاحظات منخفضة', N(by.low), '', 'تنسيق وإملاء') +
      stub('brand', 'database', 'السجلات المقروءة', N(m.weights.length + m.mirrors.length), '', 'أوزان ' + N(m.weights.length + m.mirrors.length) + ' · تحويلات ' + N(m.transfers.length) + ' · زونات ' + N(m.zoneEdits.length) + ' · التزام ' + N(m.compliance.length)) +
      stub(m.mirrors.length ? 'under-action' : 'success', 'filter-circle-xmark', 'مستبعد من الإجماليات', N(m.mirrors.length), '', 'سجلات مكررة حرفيًا بين شيتين');
    var lab = { critical: ['rejected', 'circle-exclamation', 'حرجة'], high: ['pending', 'triangle-exclamation', 'مرتفعة'], medium: ['progress', 'circle-info', 'متوسطة'], low: ['neutral', 'pen', 'منخفضة'] };
    $('qList').innerHTML = q.length ? q.map(function (x) {
      var l = lab[x.sev];
      return '<details class="q-card ' + x.sev + '"><summary>' + badge(l[0], l[1], l[2]) + '<span class="q-title">' + esc(x.title) + '</span><span class="q-count num">' + N(x.count) + '</span><i class="fa-solid fa-chevron-down" style="color:var(--ink-faint)"></i></summary>' +
        '<div class="q-body"><b>الوصف:</b> ' + esc(x.detail) + '<br><b>التصحيح المطلوب:</b> ' + esc(x.fix) +
        '<div class="table-scroll"><table class="wz"><thead><tr><th class="nosort">الموضع</th><th class="nosort">البيان</th><th class="nosort">الفرع</th><th class="nosort">التاريخ</th><th class="nosort">تفاصيل</th></tr></thead><tbody>' +
        x.sample.map(function (r) { return '<tr><td>' + esc(r.loc) + '</td><td class="mono">' + esc(r.a) + '</td><td>' + esc(r.b) + '</td><td class="num">' + esc(r.c) + '</td><td class="wrap">' + esc(r.d) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (x.count > x.sample.length ? '<small>معروض أول ' + x.sample.length + ' من ' + N(x.count) + '.</small>' : '') + '</div></details>';
    }).join('') : '<div class="wz-empty">لم تُرصد ملاحظات على جودة البيانات.</div>';
  }

  /* ---------- آلية العمل ---------- */
  function renderPolicy() {
    var lines = state.model.message, h = '', open = false;
    lines.forEach(function (t) {
      var bullet = /^\./.test(t), head = /^\d+\s*[.\-]/.test(t) || /:$/.test(t), greet = /^السادة/.test(t);
      if (greet && h) { if (open) { h += '</ul>'; open = false; } h += '<hr>'; }
      if (bullet) { if (!open) { h += '<ul>'; open = true; } h += '<li>' + esc(t.replace(/^\./, '').trim()) + '</li>'; return; }
      if (open) { h += '</ul>'; open = false; }
      h += head ? '<h4>' + esc(t) + '</h4>' : '<p>' + esc(t) + '</p>';
    });
    if (open) h += '</ul>';
    $('policyBody').innerHTML = h || '<div class="wz-empty">لا يوجد نص في تبويب «رساله الافرع».</div>';
  }

  /* =====================================================================
     التبويبات، التصدير، الإعدادات، التحميل
     ===================================================================== */
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll('.wz-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    document.querySelectorAll('.wz-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'pane-' + t); });
    $('filterBar').classList.toggle('hidden', t === 'policy' || t === 'quality');
    render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function exportCSV() {
    var s = state.sub, t = state.tab, head, rows, name;
    if (t === 'transfers') { name = 'transfers'; head = ['التاريخ', 'الفرع', 'عدد التحويلات', 'اخطاء الفرع', 'مسئول التحويل', 'مراجعه', 'اخطاء مسئول التحويل']; rows = s.transfers.filter(function (r) { return r.recorded; }).map(function (r) { return [r.d, r.br, r.count, r.brErr, r.person, r.rev, r.respErr]; }); }
    else if (t === 'zones') { name = 'zone-edits'; head = ['التاريخ', 'الفرع', 'المندوب', 'الزون', 'مسئول التعديل', 'مراجعه', 'الاخطاء']; rows = s.zoneEdits.map(function (r) { return [r.d, r.br, r.courier, r.zone, r.person, r.rev, r.err]; }); }
    else if (t === 'compliance') { name = 'compliance'; head = ['التاريخ', 'الفرع', 'الحالة بالشيت', 'التصنيف']; rows = s.compliance.filter(function (r) { return r.state !== 'future' && r.state !== 'preStart'; }).map(function (r) { return [r.d, r.br, r.raw, r.state]; }); }
    else if (t === 'quality') { name = 'data-quality'; head = ['الخطورة', 'الملاحظة', 'العدد', 'الموضع', 'البيان', 'الفرع', 'التاريخ', 'تفاصيل']; rows = []; state.model.quality.forEach(function (q) { q.sample.forEach(function (x) { rows.push([q.sev, q.title, q.count, x.loc, x.a, x.b, x.c, x.d]); }); }); }
    else { name = 'weight-adjustments'; head = ['التاريخ', 'الفرع', 'الفرع كما بالشيت', 'كود الشحنة', 'السبب', 'المراجع', 'عدد الكيلوات', 'الوزن المحسوب من الابعاد', 'الفرق', 'سعر الوزن الزائد', 'نسبة المندوب', 'المستحق للمندوب', 'الابعاد', 'ملاحظات', 'الشيت', 'الصف']; rows = s.weights.map(function (r) { return [r.d, r.br, r.brRaw, r.code, r.reason, r.person, r.kg, r.vol == null ? '' : r.vol.toFixed(2), r.volDiff == null ? '' : r.volDiff.toFixed(2), r.price, r.pct, r.courierShare, r.dims, r.note, r.sheet, r.row]; }); }
    var csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'arrive-' + name + '-' + state.model.today + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function setTheme(dark) {
    if (dark) document.documentElement.setAttribute('data-theme', 'dark'); else document.documentElement.removeAttribute('data-theme');
    $('themeIcon').className = 'fa-solid fa-' + (dark ? 'sun' : 'moon'); $('themeLabel').textContent = dark ? 'الوضع الفاتح' : 'الوضع الداكن';
    LS.set('wz_theme', dark ? 'dark' : null); if (state.model) render();
  }
  function apiUrl() { return (LS.get('wz_api_url') || CFG.APPS_SCRIPT_URL || '').trim(); }

  function setData(raw, mode, msg) {
    state.model = WZ.normalize(raw); state.mode = mode;
    var live = mode === 'live';
    $('snapBanner').classList.toggle('hidden', live);
    if (!live) $('snapBannerMsg').textContent = msg + ' — المعروض لقطة محفوظة من الشيت بتاريخ ' + D(state.model.today) + '.';
    $('connChip').dataset.state = live ? 'live' : 'demo';
    $('connLabel').textContent = live ? 'متصل بالشيت' : 'لقطة محفوظة';
    var g = String(state.model.generatedAt || '');
    $('hdrUpdated').textContent = g ? D(g.slice(0, 10)) + ' ' + g.slice(11, 16) : '—';
    $('footNote').innerHTML = 'المصدر: شيت «' + esc((state.model.source && state.model.source.title) || '') + '» · بيانات حتى ' + D(state.model.today) +
      ' · أسماء الفروع وأسباب التعديل موحَّدة آليًا للعرض دون تعديل الشيت · التحليل وصفي؛ لا يتضمن إجمالي شحنات الفرع، لذا لا تُحسب «نسبة التعديل من إجمالي الشحنات».';
    populateFilters(); render();
  }
  function useSnapshot(msg) {
    if (window.WZ_SNAPSHOT) setData(window.WZ_SNAPSHOT, 'snapshot', msg);
    else { $('snapBanner').classList.remove('hidden'); $('snapBannerMsg').textContent = msg + ' — ولا توجد لقطة محفوظة.'; }
  }
  function load(fresh) {
    var url = apiUrl();
    if (!url) { useSnapshot('لم يتم ربط Apps Script بعد'); return; }
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, CFG.REQUEST_TIMEOUT_MS || 60000);
    $('connLabel').textContent = 'جارٍ التحديث…';
    fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + (fresh ? 'fresh=1&' : '') + 't=' + Date.now(), { signal: ctl.signal, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (!j || j.error) throw new Error((j && j.error) || 'استجابة غير صالحة'); if (!Array.isArray(j.weights)) throw new Error('شكل البيانات غير متوقع'); setData(j, 'live'); })
      .catch(function (e) {
        if (console && console.warn) console.warn('[WZ] تعذّر الجلب:', e);
        if (state.model && state.mode === 'live') { $('connChip').dataset.state = 'error'; $('connLabel').textContent = 'تعذّر التحديث — آخر بيانات ناجحة'; }
        else useSnapshot('تعذّر الاتصال بـ Apps Script');
      })
      .then(function () { clearTimeout(to); });
  }

  function init() {
    ['fMonth', 'fBranch', 'fPerson', 'fReason'].forEach(mountMS);
    ['fMonth', 'fBranch', 'fPerson', 'fReason', 'fFrom', 'fTo'].forEach(function (id) { $(id).addEventListener('change', render); });
    var deb; $('fSearch').addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(render, 200); });
    $('btnReset').addEventListener('click', function () {
      ['fMonth', 'fBranch', 'fPerson', 'fReason'].forEach(function (id) { [].forEach.call($(id).options, function (o) { o.selected = false; }); MS[id].sync(); });
      $('fFrom').value = ''; $('fTo').value = ''; $('fSearch').value = ''; render();
    });
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('.wz-tab'); if (b) setTab(b.dataset.tab); });
    $('btnExport').addEventListener('click', exportCSV);
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('btnRefresh').addEventListener('click', function () { load(true); });
    $('btnTheme').addEventListener('click', function () { setTheme(!document.documentElement.hasAttribute('data-theme')); });
    function openSettings() { $('apiUrlInput').value = LS.get('wz_api_url') || CFG.APPS_SCRIPT_URL || ''; $('settingsOverlay').classList.add('open'); }
    function closeSettings() { $('settingsOverlay').classList.remove('open'); }
    $('btnSettings').addEventListener('click', openSettings); $('snapBannerBtn').addEventListener('click', openSettings);
    $('settingsClose').addEventListener('click', closeSettings);
    $('settingsOverlay').addEventListener('click', function (e) { if (e.target === $('settingsOverlay')) closeSettings(); });
    $('settingsSave').addEventListener('click', function () { LS.set('wz_api_url', $('apiUrlInput').value.trim() || null); closeSettings(); load(true); });
    $('settingsFresh').addEventListener('click', function () { closeSettings(); load(true); });
    if (LS.get('wz_theme') === 'dark') setTheme(true);
    load(false);
    var mins = +CFG.AUTO_REFRESH_MINUTES || 0;
    if (mins > 0) state.timer = setInterval(function () { if (apiUrl()) load(false); }, mins * 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
