/**
 * ARRIVE — لوحة متابعة تعديل الأوزان والزونات والتحويلات
 * Google Apps Script (Web App) — للقراءة فقط: لا يعدّل أي خلية في الشيت.
 *
 * التركيب:
 *  1) افتح شيت «متابعه تعديل الاوزان والزونات-ارييف» ← Extensions ← Apps Script.
 *  2) الصق هذا الملف كاملًا بدل المحتوى الموجود واحفظ.
 *  3) Deploy ← New deployment ← Web app:
 *       Execute as: Me   |   Who has access: Anyone
 *  4) انسخ رابط /exec وضعه في config.js (APPS_SCRIPT_URL) أو من زر «إعدادات» داخل اللوحة.
 *
 * السكربت يُرجع البيانات «خام» بنفس شكل data-snapshot.js؛
 * كل التطبيع والحساب يتم في wz-logic.js حتى يبقى منطق العمل في مكان واحد.
 *
 * التعرف على التبويبات بالاسم (أي شهر جديد يُلتقط تلقائيًا):
 *   يبدأ بـ «الاوزان»                    ← سجل تعديل الأوزان
 *   يبدأ بـ «متابعه شيتات التحويلات»     ← التزام الفروع بإرسال الشيتات
 *   يبدأ بـ «تعديل الزونات»              ← تحويلات الأفرع (A:G) + زونات المناديب (I:O)
 *   «الزونات»                            ← قائمة الزونات المعتمدة للمناديب
 *   يبدأ بـ «رساله»                      ← رسالة/آلية العمل للأفرع
 */

var AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
var CACHE_KEY = 'wz_payload_v1';
var CACHE_SECONDS = 120;

function doGet(e) {
  var out;
  try {
    var fresh = e && e.parameter && e.parameter.fresh === '1';
    out = fresh ? null : readCache_();
    if (!out) { out = JSON.stringify(buildPayload_()); writeCache_(out); }
  } catch (err) {
    out = JSON.stringify({ error: String(err && err.message || err) });
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/** للتجربة من محرر Apps Script: Run ← testPayload ثم راجع السجل. */
function testPayload() {
  var p = buildPayload_();
  Logger.log(JSON.stringify({
    weights: p.weights.length, transfers: p.transfers.length, zoneEdits: p.zoneEdits.length,
    compliance: p.compliance.length, zonesMaster: p.zonesMaster.length, message: p.message.length
  }));
}

function buildPayload_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('السكربت غير مرتبط بالشيت: افتحه من داخل الشيت (Extensions ← Apps Script) وليس كمشروع مستقل.');
  var tz = resolveTimeZone_(ss);
  var data = {
    generatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    source: { title: ss.getName() },
    weights: [], transfers: [], zoneEdits: [], compliance: [], zonesMaster: [], message: []
  };
  ss.getSheets().forEach(function (sh) {
    var name = String(sh.getName()).trim();
    if (name.indexOf('الاوزان') === 0) readWeights_(sh, name, tz, data);
    else if (name.indexOf('متابعه شيتات التحويلات') === 0) readCompliance_(sh, name, tz, data);
    else if (name.indexOf('تعديل الزونات') === 0) readDaily_(sh, tz, data);
    else if (name === 'الزونات') readZonesMaster_(sh, tz, data);
    else if (name.indexOf('رساله') === 0) readMessage_(sh, data);
  });
  return data;
}

/* ---------- أدوات ---------- */
/** المنطقة الزمنية: من الشيت، ثم من مشروع السكربت، ثم القاهرة — دائمًا نص صالح. */
function resolveTimeZone_(ss) {
  var cands = [];
  try { cands.push(ss.getSpreadsheetTimeZone()); } catch (e) {}
  try { cands.push(Session.getScriptTimeZone()); } catch (e) {}
  cands.push('Africa/Cairo');
  for (var i = 0; i < cands.length; i++) {
    var z = cands[i];
    if (typeof z !== 'string' || !z) continue;
    try { Utilities.formatDate(new Date(), z, 'yyyy-MM-dd'); return z; } catch (e) {}
  }
  return 'GMT+2';
}
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function iso_(v, tz) { return isDate_(v) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : ''; }
function txt_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) return iso_(v, tz);
  if (typeof v === 'number') return (Math.floor(v) === v) ? String(v) : String(v);
  return String(v).replace(/\s+/g, ' ').trim();
}
function num_(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
/** خلية نصية حوّلها الشيت إلى تاريخ (مثل «15 مايو») تُعاد كنص. */
function dateish_(v, tz) {
  if (!isDate_(v)) return txt_(v, tz);
  return Number(Utilities.formatDate(v, tz, 'd')) + ' ' + AR_MONTHS[Number(Utilities.formatDate(v, tz, 'M')) - 1];
}
function values_(sh, firstRow, cols) {
  var last = sh.getLastRow();
  if (last < firstRow) return [];
  return sh.getRange(firstRow, 1, last - firstRow + 1, Math.min(cols, sh.getMaxColumns())).getValues()
    .map(function (r) { while (r.length < cols) r.push(''); return r; });
}

/* ---------- سجل تعديل الأوزان: A م | B التاريخ | C الفرع | D الكود | E السبب | F المراجع | G الحالة | H الكيلوات | I السعر | J نسبة المندوب | K الأبعاد | L ملاحظات ---------- */
function readWeights_(sh, name, tz, data) {
  values_(sh, 3, 13).forEach(function (r, i) {
    var has = false;
    for (var c = 1; c <= 11; c++) if (txt_(r[c], tz) !== '') { has = true; break; }
    if (!has) return;                                   // عمود «م» مُعبّأ مسبقًا؛ الصف فارغ فعليًا
    data.weights.push({
      sheet: name, row: i + 3, d: iso_(r[1], tz), dRaw: isDate_(r[1]) ? '' : txt_(r[1], tz),
      br: txt_(r[2], tz), code: txt_(r[3], tz), codeNum: typeof r[3] === 'number',
      reason: txt_(r[4], tz), reviewer: txt_(r[5], tz), status: txt_(r[6], tz),
      kg: num_(r[7]), price: num_(r[8]), pct: num_(r[9]), dims: txt_(r[10], tz), note: txt_(r[11], tz)
    });
  });
}

/* ---------- التزام الفروع: الصف 2 أسماء الفروع، العمود A التاريخ ---------- */
function readCompliance_(sh, name, tz, data) {
  var rows = values_(sh, 2, Math.min(sh.getLastColumn(), 30));
  if (!rows.length) return;
  var heads = rows[0].map(function (h) { return txt_(h, tz); });
  rows.slice(1).forEach(function (r) {
    if (!isDate_(r[0])) return;
    for (var j = 1; j < heads.length; j++) {
      if (heads[j]) data.compliance.push({ sheet: name, d: iso_(r[0], tz), br: heads[j], st: txt_(r[j], tz) });
    }
  });
}

/* ---------- تحويلات الأفرع (A:G) + زونات المناديب (I:O) ---------- */
function readDaily_(sh, tz, data) {
  values_(sh, 3, 15).forEach(function (r, i) {
    var br = txt_(r[1], tz);
    if (br && br.indexOf('اجمال') < 0) {
      data.transfers.push({
        row: i + 3, d: iso_(r[0], tz), dRaw: isDate_(r[0]) ? '' : txt_(r[0], tz), br: br,
        count: num_(r[2]), brErr: num_(r[3]), resp: txt_(r[4], tz), rev: txt_(r[5], tz), respErr: num_(r[6])
      });
    }
    if (txt_(r[10], tz)) {
      data.zoneEdits.push({
        row: i + 3, d: iso_(r[8], tz), dRaw: isDate_(r[8]) ? '' : txt_(r[8], tz), br: txt_(r[9], tz),
        courier: txt_(r[10], tz), zone: dateish_(r[11], tz), zoneWasDate: isDate_(r[11]),
        resp: txt_(r[12], tz), rev: txt_(r[13], tz), err: num_(r[14])
      });
    }
  });
}

/* ---------- قائمة الزونات: تعبئة الخلايا المدمجة (المنطقة، اسم المندوب) ---------- */
function readZonesMaster_(sh, tz, data) {
  var last = sh.getLastRow();
  if (last < 3) return;
  var range = sh.getRange(3, 1, last - 2, 8), vals = range.getValues();
  range.getMergedRanges().forEach(function (mr) {
    var v = mr.getCell(1, 1).getValue();
    var r0 = mr.getRow() - 3, c0 = mr.getColumn() - 1;
    for (var rr = 0; rr < mr.getNumRows(); rr++) for (var cc = 0; cc < mr.getNumColumns(); cc++) {
      if (vals[r0 + rr] && c0 + cc < 8) vals[r0 + rr][c0 + cc] = v;
    }
  });
  vals.forEach(function (r) {
    var has = false;
    for (var c = 2; c <= 6; c++) if (txt_(r[c], tz) !== '') { has = true; break; }
    if (!has) return;
    data.zonesMaster.push({
      n: num_(r[0]), region: txt_(r[1], tz), br: txt_(r[2], tz), courier: txt_(r[3], tz), scope: txt_(r[4], tz),
      what: txt_(r[5], tz), to: dateish_(r[6], tz), extra: txt_(r[7], tz)
    });
  });
}

function readMessage_(sh, data) {
  var last = sh.getLastRow();
  if (last < 1) return;
  sh.getRange(1, 1, last, 1).getValues().forEach(function (r) {
    var t = String(r[0] == null ? '' : r[0]).replace(/\s+/g, ' ').trim();
    if (t && t !== '.') data.message.push(t);
  });
}

/* ---------- كاش مقسّم (حد CacheService 100KB للقيمة) ---------- */
function writeCache_(str) {
  try {
    var cache = CacheService.getScriptCache(), size = 90000, n = Math.ceil(str.length / size), obj = {};
    for (var i = 0; i < n; i++) obj[CACHE_KEY + '_' + i] = str.substr(i * size, size);
    obj[CACHE_KEY + '_n'] = String(n);
    cache.putAll(obj, CACHE_SECONDS);
  } catch (err) { /* الكاش اختياري */ }
}
function readCache_() {
  try {
    var cache = CacheService.getScriptCache(), n = Number(cache.get(CACHE_KEY + '_n'));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(CACHE_KEY + '_' + i);
    var got = cache.getAll(keys), out = '';
    for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; out += got[keys[j]]; }
    return out;
  } catch (err) { return null; }
}
