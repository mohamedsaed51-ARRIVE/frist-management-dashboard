/**
 * ============================================================================
 * FIRST MILE INTELLIGENCE DASHBOARD — Google Apps Script backend
 * ============================================================================
 * Serves one JSON payload (months/cities/areas/drivers/clients/types/
 * statuses/reasons/rows/pickupDays/driverBranch/salaryRef/meta) to the
 * dashboard's fetch() call, read live from the Google Sheet. No sheet
 * structure is changed by this script — it only reads.
 *
 * -----------------------------------------------------------------------
 * WHAT WAS WRONG BEFORE (root-cause audit)
 * -----------------------------------------------------------------------
 * 1. Header matching was CASE-SENSITIVE and used exact literal strings
 *    ('Client', 'Requst type', ...). Your sheet has 'client' (lowercase),
 *    so `findHeaderRow` never found a row containing exact 'Client' and
 *    threw "Could not locate header row containing: Date, Client, City,
 *    Area" even though row 2 clearly has all four columns.
 * 2. Even on sheets where the header row WAS found, individual column
 *    lookups like `col['Client']` used the same exact-case string. If the
 *    real header was 'client', `col['Client']` was `undefined`, so every
 *    row read `row[undefined]` -> `undefined` -> normalized to `null` ->
 *    the row-skip check (`if (!client) continue;`) silently dropped
 *    EVERY row. That's why you saw a "successful" response with
 *    `totalRecords: 0` and empty months/cities/drivers/rows — no error
 *    was thrown, the sheet was just being read into nothing.
 * 3. `doGet` had no top-level try/catch. Any thrown error (like #1)
 *    made Apps Script return its own HTML stack-trace error page instead
 *    of JSON. The dashboard's `res.json()` then fails to parse HTML as
 *    JSON, which surfaces in the browser as a generic "Failed to fetch" /
 *    parse error — even though the server did technically respond.
 * 4. The 5-minute cache had no guard against caching a broken/empty
 *    result. Once bug #2 produced an empty payload, that empty payload
 *    got cached and kept being served for 5 minutes even after you
 *    thought you'd fixed something.
 * 5. Date parsing assumed every "Date" cell is already a JS Date object.
 *    Sheets can hand back numbers (serial dates) or plain strings
 *    depending on column formatting / how rows were pasted in, and the
 *    old code silently skipped anything that wasn't already a Date.
 *
 * -----------------------------------------------------------------------
 * WHAT THIS REWRITE DOES ABOUT IT
 * -----------------------------------------------------------------------
 * - Column resolution is alias-based, case-insensitive, whitespace-
 *   normalized, and tolerant of the known "Requst type" misspelling
 *   (see CONFIG.COLUMN_ALIASES). Every place a column is read uses the
 *   resolved canonical index (col.client, col.city, ...) — never a
 *   literal header string — so a casing/spacing mismatch can't silently
 *   break row reads again.
 * - Header-row detection scans the first HEADER_SEARCH_ROWS rows,
 *   explicitly skips fully-blank rows, and if it can't find a row with
 *   every required column it throws an error that names exactly which
 *   canonical columns are still missing AND shows the best-matching row
 *   it found, so a future mismatch is diagnosable in seconds instead of
 *   guessed at.
 * - doGet() has a top-level try/catch. Any failure — anywhere — returns
 *   valid JSON with an `error` field and HTTP 200, never Apps Script's
 *   default HTML error page. The dashboard already knows how to show
 *   that error in its own error screen.
 * - The cache only stores a payload when meta.totalRecords > 0, so a
 *   broken read can never poison 5 minutes of "empty dashboard".
 * - Date parsing accepts Date objects, Sheets serial numbers, and
 *   parseable strings, in that order, before giving up on a row.
 * - Added ?diagnostic=1 (see below) so header/column detection can be
 *   verified from a browser tab, without opening the Apps Script editor.
 *
 * -----------------------------------------------------------------------
 * SHIPMENTS + EXTERNAL-COST UPDATE
 * - rows[i][10] = عدد الشحنات (عمود "Pickup")؛ pickupDays[i][11] = نفس القيمة.
 * - مفتاح التجميع صار يفصل Extra Fees>0 عن غيرها (علم E/I).
 * - salaryRef[i].extra_salary من عمود "Extra Salary" في شيت Courier Salary.
 * - مفتاح الكاش v3.
 *
 * PHASE 6A — pickupDays dataset (added, additive only)
 * -----------------------------------------------------------------------
 * - A new, independent dataset `pickupDays` is now built alongside `rows`
 *   inside readPickupRequest() and returned from buildPayload(). It is
 *   NOT a replacement for `rows` and does not change how `rows` is
 *   grouped, indexed, or counted.
 * - Every row whose request type is "Pickup" (matched case-insensitively,
 *   so 'Pickup', 'pickup', 'PICKUP', ' Pickup ' all match) AND that has a
 *   valid parsed date is emitted as its own entry in `pickupDays` — one
 *   entry per source row, never merged/aggregated across dates. `count`
 *   is always 1 by design; de-duplicating by client+date is left to the
 *   frontend / next phase, as required.
 * - Each `pickupDays` entry reuses the exact same dictionary-encoding
 *   convention as `rows` (index into months/cities/areas/drivers/types/
 *   statuses/clients/reasons), with two extra trailing fields appended:
 *   a literal count of 1, the row's fees, and the row's own date string
 *   (`YYYY-MM-DD`, from the same fmtDate() already used for dateMin/
 *   dateMax) — see readPickupRequest() below for the exact shape.
 * - No existing dictionary, alias table, column-resolution rule, cache
 *   key, cache behavior, or diagnostic/refresh mode was touched.
 * -----------------------------------------------------------------------
 *
 * DEPLOYMENT
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Delete any existing code, paste this whole file in.
 * 3. Adjust CONFIG below only if your tab names or column headers use
 *    wording not already covered by COLUMN_ALIASES.
 * 4. Deploy -> New deployment -> type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    (NOT "Anyone with Google account" — that requires sign-in and the
 *    dashboard's fetch() will fail with a CORS/redirect-to-login error.)
 * 5. Copy the URL. It must end in /exec, not /dev.
 * 6. Paste it into config.js as APPS_SCRIPT_URL (see SETUP_GUIDE.md).
 * 7. Sanity check: open ".../exec?diagnostic=1" directly in a browser
 *    tab. You should see JSON describing exactly which header row and
 *    columns were detected per sheet, with zero guesswork.
 * 8. If you ever redeploy (not just "Manage deployments -> Edit" the
 *    same deployment), Apps Script can issue a NEW URL — update
 *    config.js again in that case.
 * 9. If you are redeploying an EXISTING deployment to pick up this
 *    Phase 6A change: Deploy -> Manage deployments -> pick the active
 *    deployment -> Edit (pencil icon) -> Version: "New version" ->
 *    Deploy. Editing the script alone does NOT update the live /exec
 *    URL's behavior until a new version is deployed to it.
 * ============================================================================
 */

// ============================== CONFIG ======================================
const CONFIG = {
  SHEET_NAMES: {
    pickup: 'Pickup Request',        // matched by trimmed, case-insensitive prefix
    customer: 'Customer Data',
    courierInfo: 'Courier Data Info',
    courierSalary: 'Courier Salary'
  },

  CACHE_SECONDS: 300,          // serve cached JSON for 5 min; ?refresh=1 bypasses it
  HEADER_SEARCH_ROWS: 10,      // how many top rows to scan looking for the real header row

  // Canonical column name -> list of acceptable header text variants.
  // Matching is case-insensitive and whitespace-normalized (so "Requst
  // type", "requst  type", " REQUST TYPE " all match the same alias).
  // Add more variants here if a sheet ever uses different wording —
  // this is the ONLY place column names should ever need to change.
  COLUMN_ALIASES: {
    date:      ['Date'],
    client:    ['Client', 'Customer', 'Customer Name', 'Merchant'],
    city:      ['City'],
    area:      ['Area'],
    type:      ['Requst type', 'Request type', 'Request Type', 'Requested Type'],
    ref:       ['Ref', 'Reference'],
    driver:    ['Driver', 'Courier', 'Courier Name'],
    status:    ['Request Status', 'Status'],
    pickupNo:  ['Pickup #', 'Pickup No', 'Pickup Number', 'PickupNo'],
    fees:      ['Extra Fees', 'Extra Fee', 'ExtraFees'],
    // عدد الشحنات في كل طلب بيك أب (عمود "Pickup" في شيت Pickup Request).
    // اختياري: لو غير موجود يُحسب عدد الشحنات صفرًا ويظهر تنبيه في الداشبورد.
    shipments: ['Pickup', 'Shipments', 'Shipment', 'No of Shipments', 'Number of Shipments', 'عدد الشحنات'],
    reason:    ['Reason', 'Failure Reason'],
    recorded:  ['Recorded on system', 'Recorded On System', 'Recorded']
  },

  // Columns that MUST be resolved for the Pickup Request sheet to be usable.
  PICKUP_REQUIRED_COLUMNS: ['date', 'client', 'city', 'area', 'type', 'driver', 'status'],

  // Enum normalization so 'done'/'DONE'/'Done ' etc. all collapse to one
  // canonical value the dashboard's JS already expects.
  STATUS_ALIASES: { done: 'Done', completed: 'Done', complete: 'Done', success: 'Done',
                     fail: 'Fail', failed: 'Fail', failure: 'Fail' },
  RECORDED_ALIASES: { yes: 'Yes', y: 'Yes', true: 'Yes', no: 'No', n: 'No', false: 'No' }
};
// ==============================================================================


// ============================== ENTRY POINT ==================================

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};

    if (params.diagnostic === '1') {
      return jsonOutput(buildDiagnostics());
    }

    const bypassCache = params.refresh === '1';
    const cache = CacheService.getScriptCache();
    const cacheKey = 'first_mile_dashboard_payload_v6';

    if (!bypassCache) {
      const cached = safeCacheGet(cache, cacheKey);
      if (cached) return jsonOutput(cached, true);
    }

    const payload = buildPayload();

    // Never cache (or silently accept) a broken/empty read — surface it
    // as a real error instead of pretending the sheet has no data.
    if (!payload.meta || payload.meta.totalRecords === 0) {
      payload.meta = payload.meta || {};
      payload.meta.warning = 'totalRecords is 0 — check ?diagnostic=1 to see what was detected.';
    } else {
      safeCachePut(cache, cacheKey, payload, CONFIG.CACHE_SECONDS);
    }

    return jsonOutput(payload);

  } catch (err) {
    // CRITICAL: always return valid JSON, never let Apps Script's default
    // HTML error page reach the dashboard's res.json() call.
    return jsonOutput({
      error: true,
      message: String(err && err.message ? err.message : err),
      stack: err && err.stack ? String(err.stack) : null
    });
  }
}

function jsonOutput(obj, fromCache) {
  if (fromCache && obj && typeof obj === 'object') obj = Object.assign({}, obj, { _cached: true });
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeCacheGet(cache, key) {
  try {
    const raw = cache.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null; // corrupted cache entry — just treat as a miss
  }
}

function safeCachePut(cache, key, obj, seconds) {
  try {
    const json = JSON.stringify(obj);
    if (json.length < 95000) cache.put(key, json, seconds); // CacheService caps ~100KB/key
  } catch (err) {
    // caching is best-effort only; never let a cache failure break the response
  }
}


// ============================== SHEET HELPERS ================================

function findSheet(namePrefix) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const target = normalizeText(namePrefix);
  for (let i = 0; i < sheets.length; i++) {
    const name = normalizeText(sheets[i].getName());
    if (name.indexOf(target) === 0) return sheets[i];
  }
  throw new Error('Sheet not found for name/prefix "' + namePrefix + '". Available sheets: ' +
    SpreadsheetApp.getActiveSpreadsheet().getSheets().map(s => s.getName()).join(', '));
}

/** Trim + collapse internal whitespace + lowercase, for comparisons only. */
function normalizeText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Trim + collapse internal whitespace, KEEPING original case (for display/output). */
function cleanText(s) {
  if (s === null || s === undefined || s === '') return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

function isRowBlank(row) {
  for (let i = 0; i < row.length; i++) {
    if (cleanText(row[i]) !== null) return false;
  }
  return true;
}

/**
 * Resolves CONFIG.COLUMN_ALIASES against one header row.
 * Returns { col: {canonicalKey: columnIndex, ...}, matchedCount, headerTexts }
 */
function resolveColumns(headerRow, aliasMap) {
  const normalizedHeaderRow = headerRow.map(normalizeText);
  const col = {};
  let matchedCount = 0;

  Object.keys(aliasMap).forEach(canonicalKey => {
    const variants = aliasMap[canonicalKey].map(normalizeText);
    let foundIdx = -1;
    for (let i = 0; i < normalizedHeaderRow.length; i++) {
      if (variants.indexOf(normalizedHeaderRow[i]) !== -1) { foundIdx = i; break; }
    }
    if (foundIdx !== -1) { col[canonicalKey] = foundIdx; matchedCount++; }
  });

  return { col, matchedCount, headerTexts: headerRow.map(cleanText) };
}

/**
 * Scans the first N rows for one that resolves every column in
 * requiredKeys. Skips fully-blank rows automatically. If nothing
 * matches, throws an error naming exactly which required columns are
 * still missing on the best-scoring candidate row, and what that row's
 * actual header text was — so a future mismatch is a 5-second fix.
 */
function findHeaderRowAndColumns(values, aliasMap, requiredKeys, searchRows) {
  let best = null; // {rowIndex, col, matchedCount, headerTexts}

  for (let r = 0; r < Math.min(searchRows, values.length); r++) {
    const row = values[r];
    if (isRowBlank(row)) continue; // rule 4: ignore blank rows automatically

    const resolved = resolveColumns(row, aliasMap);
    const hasAllRequired = requiredKeys.every(k => resolved.col[k] !== undefined);

    if (!best || resolved.matchedCount > best.matchedCount) {
      best = Object.assign({ rowIndex: r }, resolved);
    }
    if (hasAllRequired) {
      return { rowIndex: r, col: resolved.col };
    }
  }

  const missing = best
    ? requiredKeys.filter(k => best.col[k] === undefined)
    : requiredKeys;
  const bestRowDesc = best
    ? 'Closest match was row ' + (best.rowIndex + 1) + ' with headers: [' + best.headerTexts.join(', ') + ']'
    : 'No non-blank row found in the first ' + searchRows + ' rows.';

  throw new Error(
    'Could not locate a header row containing all of: ' + requiredKeys.join(', ') +
    '. Still missing: ' + missing.join(', ') + '. ' + bestRowDesc +
    '. Add any differently-worded header to CONFIG.COLUMN_ALIASES in Code.gs.'
  );
}

/** Normalizes an enum-ish cell value (status/recorded) against an alias map, case-insensitively. */
function normalizeEnum(value, aliasMap) {
  const cleaned = cleanText(value);
  if (cleaned === null) return null;
  const key = normalizeText(cleaned);
  return aliasMap.hasOwnProperty(key) ? aliasMap[key] : cleaned; // fall back to the cleaned original rather than silently dropping unexpected values
}

/** Accepts a Date object, a Sheets serial-date number, or a parseable string. */
function parseDateCell(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return v;
  if (typeof v === 'number' && isFinite(v)) {
    // Google Sheets/Excel serial date epoch = Dec 30, 1899
    const epoch = new Date(1899, 11, 30);
    return new Date(epoch.getTime() + v * 86400000);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    // نص بصيغة يوم/شهر/سنة (مثل 1/6/2026 = 1 يونيو) — لا نترك new Date تفسره شهر/يوم
    const dmy = v.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (dmy && Number(dmy[2]) <= 12) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    const d = new Date(v.trim());
    if (!isNaN(d)) return d;
  }
  return null;
}

function fmtDate(d) {
  if (!d) return null;
  const y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}
function monthKeyFromDate(d) {
  if (!d) return null;
  const y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2);
  return y + '-' + m;
}

function normBranch(s) {
  const t = cleanText(s);
  if (t === null) return null;
  let b = t.replace(/^\(?\s*فرع\s*/, '').replace(/[()]/g, '').trim();
  if (b === '') return null;
  const synonyms = {
    'المعادى': 'المعادي', 'الموسسه': 'المؤسسة', 'المؤسسه': 'المؤسسة',
    'الرئيسى': 'الرئيسي', 'رئيسى': 'الرئيسي', 'الاسماعيليه': 'الاسماعيلية',
    'العجوزه': 'العجوزة'
  };
  return synonyms[b] || b;
}


// ============================== DIAGNOSTICS ==================================
/**
 * GET .../exec?diagnostic=1
 * Returns header-detection results for every sheet without running the
 * full aggregation — the fastest way to confirm column matching is
 * correct after editing a sheet, with no Apps Script editor needed.
 */
function buildDiagnostics() {
  const result = { generatedAt: new Date().toISOString(), sheets: {} };

  Object.keys(CONFIG.SHEET_NAMES).forEach(key => {
    const prefix = CONFIG.SHEET_NAMES[key];
    try {
      const sheet = findSheet(prefix);
      const values = sheet.getDataRange().getValues();
      const previewRows = values.slice(0, Math.min(CONFIG.HEADER_SEARCH_ROWS, values.length))
        .map(r => r.map(cleanText));

      let headerInfo = null;
      try {
        if (key === 'pickup') {
          const found = findHeaderRowAndColumns(values, CONFIG.COLUMN_ALIASES, CONFIG.PICKUP_REQUIRED_COLUMNS, CONFIG.HEADER_SEARCH_ROWS);
          headerInfo = {
            headerRowIndex1Based: found.rowIndex + 1,
            resolvedColumns: found.col,
            sampleDataRow: values[found.rowIndex + 1] ? values[found.rowIndex + 1].map(cleanText) : null
          };
        } else {
          headerInfo = { note: 'This sheet is not aggregation-critical; only Pickup Request is fully diagnosed here.' };
        }
      } catch (headerErr) {
        headerInfo = { error: String(headerErr.message || headerErr) };
      }

      result.sheets[key] = {
        matchedSheetName: sheet.getName(),
        totalRows: values.length,
        totalCols: values.length ? values[0].length : 0,
        previewRows: previewRows,
        headerDetection: headerInfo
      };
    } catch (err) {
      result.sheets[key] = { error: String(err.message || err) };
    }
  });

  return result;
}


// ============================== MAIN PAYLOAD =================================

function buildPayload() {
  const pickupResult = readPickupRequest();
  const registeredMerchants = readRegisteredMerchantsCount(pickupResult.clients.length);
  const branchInfo = readCourierBranches(pickupResult.drivers);
  const salaryRef = readSalaryReference();

  const recordedTotal = pickupResult.recordedYes + pickupResult.recordedNo;

  const meta = {
    totalRecords: pickupResult.totalRecords,
    processedRows: pickupResult.processedRows,
    skippedRows: pickupResult.skippedRows,
    skippedRowReasons: pickupResult.skippedRowReasons,
    headerRowIndex1Based: pickupResult.headerRowIndex + 1,
    dateMin: pickupResult.dateMin,
    dateMax: pickupResult.dateMax,
    uniqueClients: pickupResult.clients.length,
    registeredMerchants: registeredMerchants,
    uniqueDrivers: pickupResult.drivers.length,
    uniqueAreas: pickupResult.areas.length,
    uniqueCities: pickupResult.cities.length,
    uniqueTypes: pickupResult.types.length,
    hasShipments: pickupResult.hasShipments,
    totalShipments: pickupResult.totalShipments,
    recordedYes: pickupResult.recordedYes,
    recordedNo: pickupResult.recordedNo,
    recordedBlank: pickupResult.totalRecords - recordedTotal,
    branchCoverage: branchInfo.branchCoverage,
    branchTotal: pickupResult.drivers.length,
    partialMonths: [],
    generatedAt: new Date().toISOString()
  };

  return {
    months: pickupResult.months,
    cities: pickupResult.cities,
    areas: pickupResult.areas,
    drivers: pickupResult.drivers,
    clients: pickupResult.clients,
    types: pickupResult.types,
    statuses: pickupResult.statuses,
    reasons: pickupResult.reasons,
    rows: pickupResult.rows,
    pickupDays: pickupResult.pickupDays,
    pickupSummary: pickupResult.pickupSummary,
    statusDetail: pickupResult.statusDetail,
    driverBranch: branchInfo.driverBranch,
    salaryRef: salaryRef,
    meta: meta
  };
}


// ============================== PICKUP REQUEST ================================

function readPickupRequest() {
  const sheet = findSheet(CONFIG.SHEET_NAMES.pickup);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('"' + sheet.getName() + '" has fewer than 2 rows — nothing to read.');

  const header = findHeaderRowAndColumns(values, CONFIG.COLUMN_ALIASES, CONFIG.PICKUP_REQUIRED_COLUMNS, CONFIG.HEADER_SEARCH_ROWS);
  const col = header.col; // canonical-key -> column index, resolved case-insensitively

  const monthsSet = {}, citiesSet = {}, areasSet = {}, driversSet = {}, clientsSet = {}, typesSet = {}, statusesSet = {}, reasonsSet = {};
  const groups = {}; // composite-key -> {m,c,a,d,t,s,cl,r,count,fees}
  const pickupDaysRaw = []; // Phase 6A: one un-aggregated entry per valid Pickup-type row (date kept, never merged)
  const failGroups = {}; // لوحة الإدارة: تفصيل الطلبات غير المكتملة (Fail / In progress / أي حالة غير Done) حسب يوم/عميل/سبب/مدينة/حالة
  const summaryGroups = {}; // لوحة الإدارة: تجميع يومي حسب الحالة/السبب/المدينة/النوع مع الشحنات الخام (بغض النظر عن الحالة)

  let totalRecords = 0, processedRows = 0, skippedRows = 0;
  const skippedRowReasons = {}; // reason label -> count, for diagnostics
  let dateMin = null, dateMax = null;
  let recordedYes = 0, recordedNo = 0;
  let totalShipments = 0;
  const hasShipments = col.shipments !== undefined;

  function bumpSkip(reasonLabel) {
    skippedRows++;
    skippedRowReasons[reasonLabel] = (skippedRowReasons[reasonLabel] || 0) + 1;
  }

  for (let r = header.rowIndex + 1; r < values.length; r++) {
    const row = values[r];
    if (isRowBlank(row)) continue; // don't even count fully blank trailing rows

    totalRecords++;

    const dateObj = parseDateCell(row[col.date]);
    if (!dateObj) { bumpSkip('unparseable or missing date'); continue; }
    const mKey = monthKeyFromDate(dateObj);

    const city = cleanText(row[col.city]);
    const area = cleanText(row[col.area]);
    const driver = cleanText(row[col.driver]);
    const client = cleanText(row[col.client]);
    const type = cleanText(row[col.type]);
    const statusRaw = row[col.status];
    const status = normalizeEnum(statusRaw, CONFIG.STATUS_ALIASES);

    if (!city)   { bumpSkip('missing city'); continue; }
    if (!area)   { bumpSkip('missing area'); continue; }
    if (!driver) { bumpSkip('missing driver'); continue; }
    if (!client) { bumpSkip('missing client'); continue; }
    if (!type)   { bumpSkip('missing request type'); continue; }
    if (!status) { bumpSkip('missing/unrecognized status'); continue; }

    processedRows++;

    const reasonRaw = col.reason !== undefined ? cleanText(row[col.reason]) : null;
    const reason = reasonRaw === null ? 'N/A' : reasonRaw;
    const fees = col.fees !== undefined ? (Number(row[col.fees]) || 0) : 0;
    // الشحنات تُحسب للطلبات المكتملة (Done) فقط
    const ships = (hasShipments && status === 'Done') ? (Number(row[col.shipments]) || 0) : 0;
    totalShipments += ships;

    if (col.recorded !== undefined) {
      const recorded = normalizeEnum(row[col.recorded], CONFIG.RECORDED_ALIASES);
      if (recorded === 'Yes') recordedYes++; else if (recorded === 'No') recordedNo++;
    }

    monthsSet[mKey] = true; citiesSet[city] = true; areasSet[area] = true; driversSet[driver] = true;
    clientsSet[client] = true; typesSet[type] = true; statusesSet[status] = true; reasonsSet[reason] = true;

    // العلم الأخير (E/I) يفصل الطلبات ذات التكلفة الخارجية (Extra Fees > 0) عن غيرها
    // داخل نفس المجموعة، حتى يمكن حساب شحنات البيك أب الخارجي بدقة.
    const key = [mKey, city, area, driver, type, status, client, reason, fees > 0 ? 'E' : 'I'].join('|');
    if (!groups[key]) groups[key] = { m: mKey, c: city, a: area, d: driver, t: type, s: status, cl: client, r: reason, count: 0, fees: 0, ships: 0 };
    groups[key].count += 1;
    groups[key].fees += fees;
    groups[key].ships += ships;

    const dStr = fmtDate(dateObj);
    if (dStr) { if (!dateMin || dStr < dateMin) dateMin = dStr; if (!dateMax || dStr > dateMax) dateMax = dStr; }

    // ---- لوحة الإدارة (additive): عدد الطلبات والشحنات الخام لكل حالة ----
    // `ships` أعلاه يُحتسب لحالة Done فقط (قاعدة قديمة لا تُمَس). هنا نقرأ عمود
    // "Pickup" كما هو لكل الحالات حتى تظهر شحنات المُرحَّل والفاشل أيضًا.
    if (dStr) {
      const rawShips = hasShipments ? (Number(row[col.shipments]) || 0) : 0;
      const sk = [dStr, city, type, status, reason].join('|');
      if (!summaryGroups[sk]) summaryGroups[sk] = { d: dStr, c: city, t: type, s: status, r: reason, count: 0, raw: 0 };
      summaryGroups[sk].count += 1;
      summaryGroups[sk].raw += rawShips;
      if (status !== 'Done') {
        const fk = [dStr, client, reason, city, status].join('|');
        if (!failGroups[fk]) failGroups[fk] = { d: dStr, cl: client, r: reason, c: city, s: status, count: 0, raw: 0 };
        failGroups[fk].count += 1;
        failGroups[fk].raw += rawShips;
      }
    }

    // ---- Phase 6A: pickupDays (additive only — does not touch `groups`/`rows`) ----
    // Matched case-insensitively ('Pickup', 'pickup', 'PICKUP', ' Pickup ' all match)
    // so the same row that is already grouped into `rows` above is also, when it is
    // a Pickup-type row with a valid date, recorded here as its own un-aggregated
    // entry. Nothing here changes `groups`, `key`, or any of the counters above.
    if (normalizeText(type) === 'pickup' && dStr) {
      pickupDaysRaw.push({
        m: mKey, c: city, a: area, d: driver, t: type, s: status, cl: client, r: reason,
        count: 1, fees: fees, date: dStr, ships: ships
      });
    }
  }

  const months = Object.keys(monthsSet).sort();
  const cities = Object.keys(citiesSet).sort();
  const areas = Object.keys(areasSet).sort();
  const drivers = Object.keys(driversSet).sort();
  const clients = Object.keys(clientsSet).sort();
  const types = Object.keys(typesSet).sort();
  const statuses = Object.keys(statusesSet).sort();
  const reasons = Object.keys(reasonsSet).sort();

  const mIdx = {}, cIdx = {}, aIdx = {}, dIdx = {}, clIdx = {}, tIdx = {}, sIdx = {}, rIdx = {};
  months.forEach((v, i) => mIdx[v] = i); cities.forEach((v, i) => cIdx[v] = i); areas.forEach((v, i) => aIdx[v] = i);
  drivers.forEach((v, i) => dIdx[v] = i); clients.forEach((v, i) => clIdx[v] = i); types.forEach((v, i) => tIdx[v] = i);
  statuses.forEach((v, i) => sIdx[v] = i); reasons.forEach((v, i) => rIdx[v] = i);

  const rows = Object.keys(groups).map(k => {
    const g = groups[k];
    return [
      mIdx[g.m], cIdx[g.c], aIdx[g.a], dIdx[g.d], tIdx[g.t], sIdx[g.s], clIdx[g.cl], rIdx[g.r],
      g.count, Math.round(g.fees * 100) / 100, g.ships
    ];
  });

  // ---- Phase 6A: pickupDays, encoded with the SAME dictionaries/indices as `rows` ----
  // Shape per entry: [monthIdx, cityIdx, areaIdx, driverIdx, typeIdx, statusIdx,
  //                    clientIdx, reasonIdx, count(=1), fees, date("YYYY-MM-DD"), shipments]
  // Every value used here (p.m, p.c, p.a, p.d, p.t, p.s, p.cl, p.r) was captured
  // from a row that already passed the exact same validation as `rows` above, so
  // every index lookup below is guaranteed to exist — no undefined/null indices.
  const pickupDays = pickupDaysRaw.map(function (p) {
    return [
      mIdx[p.m], cIdx[p.c], aIdx[p.a], dIdx[p.d], tIdx[p.t], sIdx[p.s], clIdx[p.cl], rIdx[p.r],
      1, Math.round(p.fees * 100) / 100, p.date, p.ships
    ];
  });

  // ---- لوحة الإدارة: pickupSummary ----
  // Shape per entry: [date "YYYY-MM-DD", cityIdx, typeIdx, statusIdx, reasonIdx, requests, rawShipments]
  // نفس القواميس (cities/types/statuses/reasons) المستخدمة في rows. إضافة فقط.
  const pickupSummary = Object.keys(summaryGroups).map(function (k) {
    const g = summaryGroups[k];
    return [g.d, cIdx[g.c], tIdx[g.t], sIdx[g.s], rIdx[g.r], g.count, g.raw];
  });

  // statusDetail entry: [date, clientIdx, reasonIdx, cityIdx, requests, rawShipments, statusIdx]  (كل الحالات غير Done)
  const statusDetail = Object.keys(failGroups).map(function (k) {
    const g = failGroups[k];
    return [g.d, clIdx[g.cl], rIdx[g.r], cIdx[g.c], g.count, g.raw, sIdx[g.s]];
  });

  return {
    months, cities, areas, drivers, clients, types, statuses, reasons, rows, pickupDays, pickupSummary, statusDetail,
    totalRecords, processedRows, skippedRows, skippedRowReasons,
    hasShipments, totalShipments,
    dateMin, dateMax, recordedYes, recordedNo,
    headerRowIndex: header.rowIndex
  };
}


// ============================== CUSTOMER DATA =================================

function readRegisteredMerchantsCount(fallbackCount) {
  try {
    const sheet = findSheet(CONFIG.SHEET_NAMES.customer);
    const values = sheet.getDataRange().getValues();
    const header = findHeaderRowAndColumns(values, { name: ['Customer Name', 'Client', 'Customer'] }, ['name'], CONFIG.HEADER_SEARCH_ROWS);
    const seen = {};
    for (let r = header.rowIndex + 1; r < values.length; r++) {
      const nm = cleanText(values[r][header.col.name]);
      if (nm) seen[nm] = true;
    }
    return Object.keys(seen).length;
  } catch (err) {
    return fallbackCount; // graceful fallback — this figure is informational, not critical
  }
}


// ============================== COURIER DATA INFO ==============================

function readCourierBranches(drivers) {
  let driverBranch = drivers.map(() => null);
  let branchCoverage = 0;
  try {
    const sheet = findSheet(CONFIG.SHEET_NAMES.courierInfo);
    const values = sheet.getDataRange().getValues();
    const header = findHeaderRowAndColumns(values, { name: ['Name', 'Driver', 'Courier'], branch: ['Branch'] }, ['name', 'branch'], CONFIG.HEADER_SEARCH_ROWS);
    const branchMap = {};
    for (let r = header.rowIndex + 1; r < values.length; r++) {
      const nm = cleanText(values[r][header.col.name]);
      if (!nm) continue;
      branchMap[nm] = normBranch(values[r][header.col.branch]);
    }
    driverBranch = drivers.map(dv => branchMap.hasOwnProperty(dv) ? branchMap[dv] : null);
    branchCoverage = driverBranch.filter(b => !!b).length;
  } catch (err) {
    // leave defaults — branch mapping is a bonus insight, not critical path
  }
  return { driverBranch, branchCoverage };
}


// ============================== COURIER SALARY (reference only) ================

function readSalaryReference() {
  try {
    const sheet = findSheet(CONFIG.SHEET_NAMES.courierSalary);
    const values = sheet.getDataRange().getValues();
    const header = findHeaderRowAndColumns(
      values,
      { name: ['Name', 'Driver', 'Courier'], vehicle: ['vehicle Type', 'Vehicle Type', 'Vehicle'], salary: ['Fixd Salary', 'Fixed Salary'], extra: ['Extra Salary', 'Extra Commission'], month: ['Month'] },
      ['name', 'salary'],
      CONFIG.HEADER_SEARCH_ROWS
    );
    const out = [];
    for (let r = header.rowIndex + 1; r < values.length; r++) {
      const nm = cleanText(values[r][header.col.name]);
      if (!nm) continue;
      const salRaw = values[r][header.col.salary];
      const sal = (salRaw === '' || salRaw === null || salRaw === undefined || isNaN(Number(salRaw))) ? null : Number(salRaw);
      const extRaw = header.col.extra !== undefined ? values[r][header.col.extra] : null;
      const ext = (extRaw === '' || extRaw === null || extRaw === undefined || isNaN(Number(extRaw))) ? null : Number(extRaw);
      const monRaw = header.col.month !== undefined ? Number(values[r][header.col.month]) : NaN;
      out.push({
        name: nm,
        month: (isFinite(monRaw) && monRaw >= 1 && monRaw <= 12) ? monRaw : null,   // رقم الشهر في شيت المرتبات (صف لكل مندوب في كل شهر)
        extra_salary: ext,
        vehicle: header.col.vehicle !== undefined ? cleanText(values[r][header.col.vehicle]) : null,
        fixed_salary: sal
      });
    }
    return out;
  } catch (err) {
    return []; // reference-only sheet — never block the dashboard on this
  }
}


// ============================== MANUAL SELF-TEST ================================
/**
 * Run this from the Apps Script editor (Run -> runSelfTest) any time you
 * want a plain-language pass/fail check in the execution log, without
 * touching the deployed web app at all.
 */
function runSelfTest() {
  Logger.log('--- ARRIVE First Mile backend self-test ---');
  try {
    const diag = buildDiagnostics();
    Logger.log(JSON.stringify(diag, null, 2));
  } catch (err) {
    Logger.log('DIAGNOSTICS FAILED: ' + err.message);
  }

  try {
    const payload = buildPayload();
    Logger.log('buildPayload() OK.');
    Logger.log('totalRecords=' + payload.meta.totalRecords +
      ' processedRows=' + payload.meta.processedRows +
      ' skippedRows=' + payload.meta.skippedRows);
    Logger.log('skipped row reasons: ' + JSON.stringify(payload.meta.skippedRowReasons));
    Logger.log('months=' + payload.months.length + ' cities=' + payload.cities.length +
      ' areas=' + payload.areas.length + ' drivers=' + payload.drivers.length +
      ' clients=' + payload.clients.length + ' rows=' + payload.rows.length +
      ' pickupDays=' + payload.pickupDays.length);
    if (payload.meta.totalRecords === 0) {
      Logger.log('WARNING: totalRecords is 0. Check skippedRowReasons above and the ' +
        'headerDetection block in the diagnostics output.');
    } else {
      Logger.log('Looks healthy.');
    }
  } catch (err) {
    Logger.log('buildPayload() FAILED: ' + err.message);
    Logger.log(err.stack);
  }
}
