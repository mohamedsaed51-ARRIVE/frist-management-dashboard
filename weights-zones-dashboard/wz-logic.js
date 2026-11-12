/* =====================================================================
   ARRIVE — لوحة متابعة تعديل الأوزان والزونات والتحويلات
   منطق الحساب (بدون أي تعامل مع الواجهة) — يعمل في المتصفح وفي Node للاختبار.
   كل قاعدة عمل أو افتراض موثّق هنا في مكان واحد.
   ===================================================================== */
(function (root) {
  'use strict';

  var MISSING = 'غير محدد بالمصدر';

  /* ---- افتراضات قابلة للتعديل (غير معتمدة رسميًا — راجع README) ---- */
  var RULES = {
    VOL_TOLERANCE_KG: 1,     // فرق مسموح بين الوزن المسجل والوزن الحجمي المعاد حسابه
    OUTLIER_KG: 40,          // وزن يستحق مراجعة يدوية
    OUTLIER_PRICE: 300       // قيمة وزن زائد تستحق مراجعة يدوية
  };

  /* ---------- تطبيع النصوص ---------- */
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function normKey(s) {
    var k = clean(s).replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و')
      .replace(/[\s.\-_ـ]+/g, '');
    if (k.indexOf('فرع') === 0 && k.length > 4) k = k.slice(3);
    if (k.indexOf('ال') === 0 && k.length > 3) k = k.slice(2);
    return k;
  }
  var BRANCH_NAMES = {
    'شروق': 'الشروق', 'موسسه': 'المؤسسة', 'مدينهنصر': 'مدينة نصر', 'منصر': 'مدينة نصر',
    'حدائقالقبه': 'حدائق القبة', 'معادي': 'المعادي', 'عجوزه': 'العجوزة', 'هرم': 'الهرم',
    'اكتوبر': '6 أكتوبر', '6اكتوبر': '6 أكتوبر', 'قليوب': 'قليوب', 'اسكندريه': 'الإسكندرية',
    'مصرالجديده': 'مصر الجديدة', 'اسماعليه': 'الإسماعيلية', 'اسماعيليه': 'الإسماعيلية',
    'منوفيه': 'المنوفية', 'دمياط': 'دمياط', 'بحيره': 'البحيرة', 'بورسعيد': 'بورسعيد',
    'كفرالشيخ': 'كفر الشيخ', 'صعيد': 'الصعيد'
  };
  function normBranch(s) {
    var c = clean(s); if (!c) return MISSING;
    return BRANCH_NAMES[normKey(c)] || c;
  }
  function normReason(s) {
    var k = normKey(s);
    if (!k) return MISSING;
    if (k.indexOf('حجم') >= 0) return 'وزن حجمي';
    if (k.indexOf('فعل') >= 0) return 'وزن فعلي';
    return clean(s);
  }
  function normPerson(s) { var c = clean(s); return (!c || c === '0') ? '' : c; }
  function codeKey(s) { return clean(s).replace(/\s+/g, '').toUpperCase(); }

  /* ---------- التواريخ ---------- */
  function isISO(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }
  function validISO(d) {
    if (!isISO(d)) return false;
    var p = d.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return dt.getUTCFullYear() === +p[0] && dt.getUTCMonth() === +p[1] - 1 && dt.getUTCDate() === +p[2];
  }
  /* تاريخ مستقبلي نتج عن قراءة «يوم/شهر» كـ «شهر/يوم» (مثل 12/11 → 11 ديسمبر): نعكسه إن كان العكس صحيحًا وغير مستقبلي. */
  function fixSwappedDate(d, today) {
    if (!validISO(d) || d <= today) return { d: d, swapped: false };
    var p = d.split('-'), sw = p[0] + '-' + p[2] + '-' + p[1];
    if (validISO(sw) && sw <= today) return { d: sw, swapped: true };
    return { d: d, swapped: false };
  }
  function monthOf(d) { return isISO(d) ? d.slice(0, 7) : ''; }
  var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  function monthLabel(m) { return m ? AR_MONTHS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) : MISSING; }

  /* ---------- الوزن الحجمي ---------- */
  var DIM_RE = /^\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/;
  function volumetric(dims) {
    var m = DIM_RE.exec(dims || '');
    if (!m || +m[4] === 0) return null;
    return (+m[1]) * (+m[2]) * (+m[3]) / (+m[4]);
  }

  /* =====================================================================
     normalize(raw) — يحوّل الاستجابة الخام (Apps Script أو اللقطة) إلى نموذج موحّد
     ===================================================================== */
  function normalize(raw) {
    raw = raw || {};
    var today = String(raw.generatedAt || '').slice(0, 10);
    if (!validISO(today)) today = new Date().toISOString().slice(0, 10);

    var followed = {};   // الفروع المتابَعة = الواردة في شيتات التحويلات والالتزام
    (raw.compliance || []).forEach(function (r) { followed[normBranch(r.br)] = true; });
    (raw.transfers || []).forEach(function (r) { followed[normBranch(r.br)] = true; });
    var courierNames = {};
    (raw.zonesMaster || []).forEach(function (r) { if (clean(r.courier)) courierNames[clean(r.courier)] = true; });

    /* --- تعديلات الأوزان --- */
    var codeCount = {};
    (raw.weights || []).forEach(function (r) { var k = codeKey(r.code); if (k) codeCount[k] = (codeCount[k] || 0) + 1; });
    var weights = (raw.weights || []).map(function (r) {
      var fx = fixSwappedDate(r.d, today);
      var reason = normReason(r.reason), kg = typeof r.kg === 'number' ? r.kg : null;
      var price = typeof r.price === 'number' ? r.price : null, pct = typeof r.pct === 'number' ? r.pct : null;
      var vol = null, volDiff = null, volFlag = 'na';
      if (reason === 'وزن حجمي') {
        vol = volumetric(r.dims);
        if (vol == null || kg == null) volFlag = 'unparsed';
        else { volDiff = kg - vol; volFlag = Math.abs(volDiff) > RULES.VOL_TOLERANCE_KG ? (volDiff > 0 ? 'over' : 'under') : 'ok'; }
      }
      var brRaw = clean(r.br), br = normBranch(r.br);
      return {
        sheet: r.sheet, row: r.row, d: fx.d, dateSwapped: fx.swapped, month: monthOf(fx.d),
        brRaw: brRaw, br: br, brFollowed: !!followed[br], brIsCourier: !!courierNames[brRaw],
        code: clean(r.code), codeNum: !!r.codeNum, dup: codeCount[codeKey(r.code)] > 1,
        reasonRaw: clean(r.reason), reason: reason, person: normPerson(r.reviewer) || MISSING,
        status: clean(r.status), kg: kg, price: price, pct: pct,
        courierShare: (price != null && pct != null) ? price * pct : null,
        dims: clean(r.dims), note: clean(r.note), vol: vol, volDiff: volDiff, volFlag: volFlag
      };
    });

    /* سجل بلا تاريخ يطابق حرفيًا (كود + وزن + قيمة) سجلًا مؤرَّخًا = إدخال مكرر في شيت آخر:
       يُستبعد من كل الإجماليات حتى لا تُحتسب قيمته مرتين، ويُعرض في جودة البيانات. */
    var datedKey = {};
    weights.forEach(function (r) { if (r.d) datedKey[codeKey(r.code) + '|' + r.kg + '|' + r.price] = r; });
    var mirrors = [];
    weights = weights.filter(function (r) {
      var twin = !r.d && codeKey(r.code) ? datedKey[codeKey(r.code) + '|' + r.kg + '|' + r.price] : null;
      if (!twin) return true;
      r.twin = twin.sheet + ' — صف ' + twin.row + ' (' + twin.d + ')'; mirrors.push(r); return false;
    });
    var cc2 = {};
    weights.forEach(function (r) { var k = codeKey(r.code); if (k) cc2[k] = (cc2[k] || 0) + 1; });
    weights.forEach(function (r) { r.dup = cc2[codeKey(r.code)] > 1; });

    /* --- تحويلات الأفرع (سجل يومي لكل فرع) --- */
    var transfers = (raw.transfers || []).map(function (r) {
      var fx = fixSwappedDate(r.d, today);
      return {
        row: r.row, d: fx.d, dateSwapped: fx.swapped, month: monthOf(fx.d), br: normBranch(r.br),
        count: typeof r.count === 'number' ? r.count : null, brErr: typeof r.brErr === 'number' ? r.brErr : null,
        person: normPerson(r.resp), rev: normPerson(r.rev), respErr: typeof r.respErr === 'number' ? r.respErr : null,
        recorded: typeof r.count === 'number'
      };
    });

    /* --- تعديل زونات المناديب (سجل يومي لكل مندوب) --- */
    var zoneEdits = (raw.zoneEdits || []).map(function (r) {
      var fx = fixSwappedDate(r.d, today);
      return {
        row: r.row, d: fx.d, dateSwapped: fx.swapped, month: monthOf(fx.d), br: normBranch(r.br),
        courier: clean(r.courier), zone: clean(r.zone).replace(/^(\d+)\s*فدان/, '$1 فدان'), zoneWasDate: !!r.zoneWasDate,
        person: normPerson(r.resp) || MISSING, rev: normPerson(r.rev), err: typeof r.err === 'number' ? r.err : 0
      };
    });

    /* --- التزام الفروع بإرسال شيتات التحويلات --- */
    var firstRecorded = {};  // أول يوم مسجَّل في كل شيت: ما قبله = قبل بدء المتابعة
    (raw.compliance || []).forEach(function (r) {
      var st = clean(r.st);
      if (st && st !== '/' && (!firstRecorded[r.sheet] || r.d < firstRecorded[r.sheet])) firstRecorded[r.sheet] = r.d;
    });
    var compliance = (raw.compliance || []).map(function (r) {
      var st = clean(r.st), state;
      if (st.indexOf('لم') >= 0) state = 'notSent';
      else if (st.indexOf('تم') >= 0) state = 'sent';
      else if (st === '/') state = 'na';
      else if (st) state = 'other';
      else if (r.d > today) state = 'future';
      else if (r.d === today) state = 'pending';
      else if (!firstRecorded[r.sheet] || r.d < firstRecorded[r.sheet]) state = 'preStart';
      else state = 'unrecorded';
      return { sheet: r.sheet, d: r.d, month: monthOf(r.d), br: normBranch(r.br), raw: st, state: state };
    });

    var zonesMaster = (raw.zonesMaster || []).map(function (r) {
      return { n: r.n, region: clean(r.region) || MISSING, br: normBranch(r.br), courier: clean(r.courier) || MISSING,
        scope: clean(r.scope) || MISSING, what: clean(r.what), to: clean(r.to), extra: clean(r.extra) };
    });

    var model = {
      today: today, generatedAt: raw.generatedAt || '', source: raw.source || {},
      weights: weights, mirrors: mirrors, transfers: transfers, zoneEdits: zoneEdits, compliance: compliance,
      zonesMaster: zonesMaster, message: raw.message || [], followed: Object.keys(followed)
    };
    model.quality = buildQuality(model);
    return model;
  }

  /* =====================================================================
     الفلاتر — تُطبَّق على كل الجداول؛ الحقل غير الموجود في جدول يُتجاهَل فيه
     f = {months:[], branches:[], persons:[], reasons:[], from:'', to:'', q:''}
     ===================================================================== */
  function passDate(d, f) {
    var dated = (f.months && f.months.length) || f.from || f.to;
    if (!d) return !dated;                       // سجل بلا تاريخ: يُستبعد عند أي تصفية زمنية
    if (f.months && f.months.length && f.months.indexOf(d.slice(0, 7)) < 0) return false;
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  }
  function inList(v, list) { return !list || !list.length || list.indexOf(v) >= 0; }
  function matchQ(q, parts) {
    if (!q) return true;
    var hay = parts.join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; });
  }
  function applyFilters(m, f) {
    f = f || {};
    return {
      weights: m.weights.filter(function (r) {
        return passDate(r.d, f) && inList(r.br, f.branches) && inList(r.person, f.persons) && inList(r.reason, f.reasons) &&
          matchQ(f.q, [r.code, r.br, r.brRaw, r.person, r.dims, r.note, r.reason]);
      }),
      transfers: m.transfers.filter(function (r) {
        return passDate(r.d, f) && inList(r.br, f.branches) && (!f.persons || !f.persons.length || f.persons.indexOf(r.person) >= 0) &&
          matchQ(f.q, [r.br, r.person, r.rev]);
      }),
      zoneEdits: m.zoneEdits.filter(function (r) {
        return passDate(r.d, f) && inList(r.br, f.branches) && inList(r.person, f.persons) &&
          matchQ(f.q, [r.br, r.courier, r.zone, r.person]);
      }),
      compliance: m.compliance.filter(function (r) { return passDate(r.d, f) && inList(r.br, f.branches); }),
      zonesMaster: m.zonesMaster.filter(function (r) {
        return inList(r.br, f.branches) && matchQ(f.q, [r.br, r.courier, r.what, r.to, r.region]);
      })
    };
  }

  /* ---------- أدوات تجميع ---------- */
  function sum(rows, fn) { var t = 0; rows.forEach(function (r) { var v = fn(r); if (typeof v === 'number' && isFinite(v)) t += v; }); return t; }
  function groupBy(rows, keyFn) {
    var map = {}, order = [];
    rows.forEach(function (r) { var k = keyFn(r); if (!map[k]) { map[k] = []; order.push(k); } map[k].push(r); });
    return order.map(function (k) { return { key: k, rows: map[k] }; });
  }
  function uniq(rows, fn) { var s = {}; rows.forEach(function (r) { var v = fn(r); if (v) s[v] = 1; }); return Object.keys(s); }
  function rate(a, b) { return b ? a / b : null; }

  /* =====================================================================
     مؤشرات تعديل الأوزان
     ===================================================================== */
  function weightStats(rows) {
    var volRows = rows.filter(function (r) { return r.reason === 'وزن حجمي'; });
    var checked = volRows.filter(function (r) { return r.volFlag === 'ok' || r.volFlag === 'over' || r.volFlag === 'under'; });
    var mism = checked.filter(function (r) { return r.volFlag !== 'ok'; });
    var days = uniq(rows, function (r) { return r.d; });
    var value = sum(rows, function (r) { return r.price; });
    return {
      count: rows.length,
      shipments: uniq(rows, function (r) { return codeKey(r.code); }).length,
      value: value,
      courierShare: sum(rows, function (r) { return r.courierShare; }),
      kg: sum(rows, function (r) { return r.kg; }),
      avgValue: rate(value, rows.length),
      avgKg: rate(sum(rows, function (r) { return r.kg; }), rows.length),
      days: days.length,
      dailyAvg: rate(rows.filter(function (r) { return r.d; }).length, days.length),
      volCount: volRows.length, actualCount: rows.filter(function (r) { return r.reason === 'وزن فعلي'; }).length,
      volShare: rate(volRows.length, rows.length),
      volChecked: checked.length, volMismatch: mism.length,
      volOver: mism.filter(function (r) { return r.volFlag === 'over'; }).length,
      volUnder: mism.filter(function (r) { return r.volFlag === 'under'; }).length,
      volUnparsed: volRows.length - checked.length,
      volMatchRate: rate(checked.length - mism.length, checked.length),
      undated: rows.filter(function (r) { return !r.d; }).length,
      dupRows: rows.filter(function (r) { return r.dup; }).length
    };
  }
  function weightsBy(rows, keyFn) {
    return groupBy(rows, keyFn).map(function (g) { var s = weightStats(g.rows); s.key = g.key; s.share = rate(g.rows.length, rows.length); return s; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /* =====================================================================
     مؤشرات التحويلات
     نسبة أخطاء الفرع = أخطاء الفرع ÷ عدد التحويلات (للأيام المسجلة فقط)
     ===================================================================== */
  function transferStats(rows) {
    var rec = rows.filter(function (r) { return r.recorded; });
    var count = sum(rec, function (r) { return r.count; }), brErr = sum(rec, function (r) { return r.brErr; }), respErr = sum(rec, function (r) { return r.respErr; });
    return {
      count: count, brErr: brErr, respErr: respErr,
      brErrRate: rate(brErr, count), respErrRate: rate(respErr, count),
      days: uniq(rec, function (r) { return r.d; }).length,
      branches: uniq(rec.filter(function (r) { return r.count > 0; }), function (r) { return r.br; }).length,
      pendingRows: rows.length - rec.length
    };
  }
  function transfersBy(rows, keyFn) {
    return groupBy(rows.filter(function (r) { return r.recorded; }), keyFn).map(function (g) { var s = transferStats(g.rows); s.key = g.key; return s; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /* =====================================================================
     مؤشرات تعديل زونات المناديب
     نسبة الأخطاء = مجموع أخطاء مسؤول التعديل ÷ عدد التعديلات (قد يتجاوز 100% لأن الصف الواحد قد يحمل أكثر من خطأ)
     ===================================================================== */
  function zoneStats(rows) {
    var err = sum(rows, function (r) { return r.err; });
    return {
      count: rows.length, err: err, errRows: rows.filter(function (r) { return r.err > 0; }).length,
      errRowRate: rate(rows.filter(function (r) { return r.err > 0; }).length, rows.length),
      couriers: uniq(rows, function (r) { return r.br + '|' + r.courier; }).length,
      zones: uniq(rows, function (r) { return r.zone; }).length,
      days: uniq(rows, function (r) { return r.d; }).length
    };
  }
  function zonesBy(rows, keyFn) {
    return groupBy(rows, keyFn).map(function (g) { var s = zoneStats(g.rows); s.key = g.key; return s; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /* =====================================================================
     التزام الفروع بإرسال شيت التحويلات
     نسبة الالتزام = تم الإرسال ÷ (تم الإرسال + لم يرسل). «/» والأيام غير المسجلة خارج المقام.
     ===================================================================== */
  function complianceStats(rows) {
    var c = { sent: 0, notSent: 0, na: 0, unrecorded: 0, pending: 0, future: 0, preStart: 0, other: 0 };
    rows.forEach(function (r) { c[r.state]++; });
    c.due = c.sent + c.notSent;
    c.rate = rate(c.sent, c.due);
    return c;
  }
  function complianceBy(rows, keyFn) {
    return groupBy(rows, keyFn).map(function (g) { var s = complianceStats(g.rows); s.key = g.key; return s; });
  }

  /* =====================================================================
     أداء المسؤولين (حقائق فقط — لا توجد درجة مركّبة لعدم وجود أوزان معتمدة)
     ===================================================================== */
  function staffStats(sub) {
    var map = {};
    function get(n) { return map[n] || (map[n] = { name: n, weightReviews: 0, weightValue: 0, volChecked: 0, volMismatch: 0, transfers: 0, transferErr: 0, zoneEdits: 0, zoneErr: 0 }); }
    sub.weights.forEach(function (r) {
      var p = get(r.person); p.weightReviews++; p.weightValue += r.price || 0;
      if (r.volFlag === 'ok' || r.volFlag === 'over' || r.volFlag === 'under') { p.volChecked++; if (r.volFlag !== 'ok') p.volMismatch++; }
    });
    sub.transfers.forEach(function (r) { if (!r.recorded || !r.person) return; var p = get(r.person); p.transfers += r.count || 0; p.transferErr += r.respErr || 0; });
    sub.zoneEdits.forEach(function (r) { var p = get(r.person); p.zoneEdits++; p.zoneErr += r.err || 0; });
    return Object.keys(map).map(function (k) {
      var p = map[k];
      p.transferErrRate = rate(p.transferErr, p.transfers); p.zoneErrRate = rate(p.zoneErr, p.zoneEdits);
      p.volMismatchRate = rate(p.volMismatch, p.volChecked); p.totalErr = p.transferErr + p.zoneErr;
      return p;
    }).sort(function (a, b) { return (b.weightReviews + b.transfers + b.zoneEdits) - (a.weightReviews + a.transfers + a.zoneEdits); });
  }

  /* =====================================================================
     جودة البيانات — على كامل البيانات (لا تتأثر بالفلاتر)
     أساس التصنيف:
       حرجة   = تؤثر على صحة الإجماليات
       مرتفعة = تمنع نسب السجل لفترة/مسؤول أو تمس قيمة مالية
       متوسطة = قد تشوّه التوزيعات حسب الفرع/اليوم
       منخفضة = تنسيق وإملاء
     ===================================================================== */
  function buildQuality(m) {
    var out = [], W = m.weights;
    function add(id, sev, title, rows, detail, fix, fmt) {
      if (!rows.length) return;
      out.push({ id: id, sev: sev, title: title, count: rows.length, detail: detail, fix: fix, sample: rows.slice(0, 60).map(fmt) });
    }
    var wf = function (r) { return { loc: r.sheet + ' — صف ' + r.row, a: r.code, b: r.brRaw, c: r.d || MISSING, d: (r.kg == null ? '' : r.kg + ' كجم') + (r.price == null ? '' : ' · ' + r.price + ' ج.م') }; };

    add('w-mirror', 'critical', 'سجلات مكررة حرفيًا في شيتين (مستبعدة من إجماليات اللوحة)',
      m.mirrors || [],
      'سجلات بلا تاريخ في شيت شهر سابق تطابق بالكود والوزن والقيمة سجلات مؤرَّخة في شيت الشهر الحالي؛ بقاؤها يضاعف العدد والقيمة عند جمع الشيتين.',
      'حذف الصفوف المكررة من الشيت القديم بعد التأكد.',
      function (r) { var o = wf(r); o.c = 'مطابق لـ: ' + r.twin; return o; });

    add('w-incomplete', 'high', 'سجلات تعديل أوزان بدون تاريخ أو سبب أو مراجع',
      W.filter(function (r) { return !r.d || r.reason === MISSING || r.person === MISSING; }),
      'سجلات مُدخلة بكود ووزن وسعر فقط؛ لا يمكن نسبها ليوم أو لمراجع، وتُستبعد من أي تحليل زمني.',
      'استكمال التاريخ وسبب التعديل والمراجع والحالة لكل سجل.', wf);

    add('w-dup', 'high', 'كود شحنة مكرر في سجل تعديل الأوزان',
      W.filter(function (r) { return r.dup; }),
      'نفس كود الشحنة مسجَّل أكثر من مرة؛ قد يعني تعديلًا مكررًا أو احتساب قيمة الوزن الزائد مرتين.',
      'مراجعة كل كود: إن كان تعديلًا ثانيًا مقصودًا يُوضَّح في الملاحظات، وإلا يُحذف التكرار.', wf);

    add('w-price0', 'high', 'تعديل وزن بقيمة وزن زائد = صفر أو بدون قيمة',
      W.filter(function (r) { return r.price == null || r.price === 0; }),
      'تعديل مسجَّل دون قيمة مالية مقابلة.', 'التأكد من القيمة أو توضيح سبب عدم التحصيل.', wf);

    var pctCount = {}; W.forEach(function (r) { if (r.pct != null) pctCount[r.pct] = (pctCount[r.pct] || 0) + 1; });
    var modePct = Object.keys(pctCount).sort(function (a, b) { return pctCount[b] - pctCount[a]; })[0];
    add('w-pct', 'high', 'نسبة «ما يصرف للمندوب» مختلفة عن النسبة السائدة (' + (modePct ? Math.round(modePct * 100) + '%' : '—') + ')',
      W.filter(function (r) { return r.pct != null && modePct != null && String(r.pct) !== String(modePct); }),
      'نسبة صرف مختلفة عن باقي السجلات.', 'التأكد من أن الاستثناء معتمد، وتوثيق سببه في الملاحظات.',
      function (r) { var o = wf(r); o.d = 'النسبة: ' + Math.round(r.pct * 100) + '% · ' + r.price + ' ج.م'; return o; });

    add('w-vol', 'medium', 'وزن حجمي مسجَّل يختلف عن الأبعاد بأكثر من ' + RULES.VOL_TOLERANCE_KG + ' كجم',
      W.filter(function (r) { return r.volFlag === 'over' || r.volFlag === 'under'; }),
      'إعادة حساب (طول×عرض×ارتفاع÷المعامل) من عمود الأبعاد لا تطابق «عدد الكيلوات» المسجَّل.',
      'مراجعة الأبعاد أو الوزن المسجَّل لكل شحنة، وتوثيق قاعدة التقريب المعتمدة.',
      function (r) { var o = wf(r); o.d = 'مسجَّل ' + r.kg + ' · محسوب ' + r.vol.toFixed(2) + ' (' + r.dims + ')'; return o; });

    add('w-dims', 'medium', 'وزن حجمي بدون أبعاد قابلة للتحقق',
      W.filter(function (r) { return r.volFlag === 'unparsed'; }),
      'سبب التعديل «وزن حجمي» لكن عمود الأبعاد فارغ أو مكتوب بصيغة لا تُحسب (مثل ** أو // أو نص).',
      'كتابة الأبعاد بالصيغة: طول*عرض*ارتفاع/5000.',
      function (r) { var o = wf(r); o.d = r.dims || 'فارغ'; return o; });

    add('w-branch-out', 'medium', 'اسم فرع خارج قائمة الفروع المتابَعة',
      W.filter(function (r) { return !r.brFollowed; }),
      'فرع غير وارد في شيتات التحويلات/الالتزام (قد يكون فرع محافظات، أو اسم مندوب مكتوبًا في خانة الفرع).',
      'توحيد قائمة الفروع بقائمة منسدلة، وتصحيح الأسماء غير الصحيحة.',
      function (r) { var o = wf(r); o.d = r.brIsCourier ? 'الاسم مطابق لاسم مندوب في شيت الزونات' : ''; return o; });

    var variants = {};
    W.forEach(function (r) { if (r.brRaw && r.brRaw !== r.br && BRANCH_NAMES[normKey(r.brRaw)]) { (variants[r.br] = variants[r.br] || {})[r.brRaw] = ((variants[r.br] || {})[r.brRaw] || 0) + 1; } });
    var multi = Object.keys(variants).filter(function (b) { return Object.keys(variants[b]).length > 1; });
    if (multi.length) out.push({
      id: 'w-branch-var', sev: 'medium', title: 'نفس الفرع مكتوب بأكثر من صيغة', count: multi.length,
      detail: 'اختلاف الكتابة (مثل: مؤسسه / المؤسسة — معادى / المعادي / معادي) يقسّم أرقام الفرع عند أي تجميع داخل الشيت. اللوحة توحّدها تلقائيًا.',
      fix: 'قائمة منسدلة (Data validation) لعمود اسم الفرع.',
      sample: multi.map(function (b) { return { loc: b, a: Object.keys(variants[b]).map(function (v) { return v + ' (' + variants[b][v] + ')'; }).join(' ، '), b: '', c: '', d: '' }; })
    });

    add('w-code-num', 'low', 'كود شحنة رقمي بدون بادئة',
      W.filter(function (r) { return r.codeNum || /^\d+$/.test(r.code); }),
      'الكود مُدخل كرقم فقط خلافًا لباقي الأكواد (Arv / Av / Rv …).', 'التأكد من صحة الكود.', wf);

    add('w-outlier', 'low', 'قيم مرتفعة تستحق مراجعة يدوية (≥ ' + RULES.OUTLIER_KG + ' كجم أو ≥ ' + RULES.OUTLIER_PRICE + ' ج.م)',
      W.filter(function (r) { return (r.kg != null && r.kg >= RULES.OUTLIER_KG) || (r.price != null && r.price >= RULES.OUTLIER_PRICE); }),
      'ليست خطأ بالضرورة؛ قيم بعيدة عن النمط المعتاد.', 'مراجعة المستند المؤيد (صورة الميزان/الأبعاد).', wf);

    var rv = {}; W.forEach(function (r) { if (r.reasonRaw && r.reasonRaw !== r.reason) rv[r.reasonRaw] = (rv[r.reasonRaw] || 0) + 1; });
    if (Object.keys(rv).length) out.push({
      id: 'w-reason-var', sev: 'low', title: 'اختلاف إملائي في سبب التعديل', count: Object.keys(rv).reduce(function (t, k) { return t + rv[k]; }, 0),
      detail: 'مثل «حجمى» بدل «حجمي». اللوحة توحّدها تلقائيًا.', fix: 'قائمة منسدلة لعمود سبب التعديل.',
      sample: Object.keys(rv).map(function (k) { return { loc: k, a: rv[k] + ' سجل', b: '', c: '', d: '' }; })
    });

    var sw = m.transfers.filter(function (r) { return r.dateSwapped; }).map(function (r) { return { loc: 'تعديل الزونات+الاوزان — صف ' + r.row, a: r.br, b: 'تحويلات', c: r.d, d: '' }; })
      .concat(m.zoneEdits.filter(function (r) { return r.dateSwapped; }).map(function (r) { return { loc: 'تعديل الزونات+الاوزان — صف ' + r.row, a: r.courier, b: 'زونات', c: r.d, d: '' }; }))
      .concat(W.filter(function (r) { return r.dateSwapped; }).map(function (r) { return { loc: r.sheet + ' — صف ' + r.row, a: r.code, b: 'أوزان', c: r.d, d: '' }; }));
    if (sw.length) out.push({
      id: 'date-swap', sev: 'medium', title: 'تاريخ مُدخل بترتيب (شهر/يوم) معكوس', count: sw.length,
      detail: 'التاريخ في الشيت يُقرأ كتاريخ مستقبلي (مثال: 12/11 قُرئ 11 ديسمبر). اللوحة تعكسه تلقائيًا إلى التاريخ المنطقي المعروض هنا.',
      fix: 'إعادة إدخال التاريخ بصيغة صحيحة وتثبيت تنسيق العمود كتاريخ.', sample: sw.slice(0, 60)
    });

    var zd = m.zoneEdits.filter(function (r) { return r.zoneWasDate; });
    if (zd.length) out.push({
      id: 'zone-date', sev: 'low', title: 'اسم زون تحوّل تلقائيًا إلى تاريخ', count: zd.length,
      detail: 'قيمة مثل «15 مايو» حوّلها الشيت إلى تاريخ. اللوحة تعرضها كنص.', fix: 'تنسيق عمود الزون كنص عادي (Plain text).',
      sample: zd.map(function (r) { return { loc: 'تعديل الزونات+الاوزان — صف ' + r.row, a: r.courier, b: r.br, c: r.d, d: r.zone }; })
    });

    var un = m.compliance.filter(function (r) { return r.state === 'unrecorded'; });
    if (un.length) out.push({
      id: 'comp-unrecorded', sev: 'medium', title: 'أيام مضت دون تسجيل حالة إرسال شيت التحويلات', count: un.length,
      detail: 'خانة فارغة ليوم سابق بعد بدء المتابعة؛ لا يُعرف إن كان الفرع أرسل أم لا، فتخرج من مقام نسبة الالتزام.',
      fix: 'استكمال الحالة (تم الإرسال والتعديل / لم يرسل / «/»).',
      sample: un.slice(0, 60).map(function (r) { return { loc: r.sheet, a: r.br, b: '', c: r.d, d: '' }; })
    });

    var order = { critical: 0, high: 1, medium: 2, low: 3 };
    return out.sort(function (a, b) { return order[a.sev] - order[b.sev] || b.count - a.count; });
  }

  var api = {
    MISSING: MISSING, RULES: RULES, clean: clean, normKey: normKey, normBranch: normBranch, normReason: normReason,
    fixSwappedDate: fixSwappedDate, validISO: validISO, monthLabel: monthLabel, volumetric: volumetric, codeKey: codeKey,
    normalize: normalize, applyFilters: applyFilters, sum: sum, groupBy: groupBy, uniq: uniq, rate: rate,
    weightStats: weightStats, weightsBy: weightsBy, transferStats: transferStats, transfersBy: transfersBy,
    zoneStats: zoneStats, zonesBy: zonesBy, complianceStats: complianceStats, complianceBy: complianceBy, staffStats: staffStats
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WZ = api;
})(typeof window !== 'undefined' ? window : globalThis);
