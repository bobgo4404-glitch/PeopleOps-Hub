// PeopleOps Hub 순수 로직: 명부 변환·병합, 시점 속성 복원, 피벗 통계. 화면·Firebase와 무관하다(node로 테스트).

// ---------- 날짜 ----------
export function toISO(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number" && v > 20000 && v < 80000) { // 엑셀 날짜 일련번호
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/) || s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function todayISO(now = new Date()) { return toISO(now); }

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function monthEnd(ym) { // "2026-02" → "2026-02-28"
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function monthsBetween(fromYm, toYm) {
  const out = [];
  let [y, m] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// 만 나이
export function ageAt(birth, date) {
  if (!birth || !date) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
}

// 근속(년, 소수). 퇴직자는 퇴직일까지.
export function tenureAt(emp, date) {
  if (!emp.joinDate) return null;
  const end = emp.retireDate && emp.retireDate < date ? emp.retireDate : date;
  const ms = new Date(`${end}T00:00:00Z`) - new Date(`${emp.joinDate}T00:00:00Z`);
  return ms < 0 ? null : ms / (365.2425 * 86400000);
}

// ---------- 명부 변환 ----------
// 주민(외국인)등록번호 → 생년월일, 앞 7자리(저장은 여기까지만)
export function birthFromRrn(rrn) {
  const digits = String(rrn || "").replace(/\D/g, "");
  if (digits.length < 7) return { birthDate: "", rrnFront7: "" };
  const g = digits[6];
  const century = "1256".includes(g) ? 1900 : "3478".includes(g) ? 2000 : "90".includes(g) ? 1800 : 1900;
  const y = century + Number(digits.slice(0, 2));
  return { birthDate: `${y}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`, rrnFront7: `${digits.slice(0, 6)}-${g}` };
}

const clean = (v) => (v === null || v === undefined || v === "--" ? "" : String(v).trim());

// 명부 열 → 앱 항목. 급여·보험·계좌·부양가족 열은 가져오지 않는다.
export const ROSTER_COLUMNS = {
  사원코드: "empNo", 사원명: "name", 내외국인구분: "foreigner", 국가명: "nationality", 성별: "gender",
  입사일자: "joinDate", 퇴사일자: "retireDate", 우편번호: "zip", 주소: "address", 부서: "dept",
  직급: "grade", 직종: "jobType", 호봉: "step", 전화번호: "tel", 휴대폰번호: "mobile", 이메일: "email",
};
export const ROSTER_FIELDS = [...Object.values(ROSTER_COLUMNS), "birthDate", "rrnFront7"];

export function parseRosterRow(row) {
  const out = {};
  for (const [col, key] of Object.entries(ROSTER_COLUMNS)) out[key] = clean(row[col]);
  out.joinDate = toISO(row["입사일자"]);
  out.retireDate = toISO(row["퇴사일자"]);
  Object.assign(out, birthFromRrn(row["주민(외국인)등록번호"]));
  return out;
}

export function parseRoster(rows) {
  const missing = ["사원코드", "사원명", "부서", "입사일자"].filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) throw new Error(`명부에 필요한 열이 없습니다: ${missing.join(", ")}`);
  return rows.map(parseRosterRow).filter((e) => e.empNo && e.name);
}

// ---------- 상태·이력 ----------
export const TRACKED = ["name", "dept", "grade", "position", "jobType", "employmentType", "location", "status", "retireDate"];
export const FIELD_LABELS = {
  empNo: "사번", name: "이름", dept: "부서", grade: "직급", position: "직책", jobType: "직종",
  employmentType: "고용형태", location: "근무지", status: "재직상태", retireDate: "퇴사일", joinDate: "입사일",
  birthDate: "생년월일", gender: "성별", foreigner: "내외국인", nationality: "국적", disability: "장애",
  step: "호봉", tel: "전화", mobile: "휴대폰", email: "이메일", zip: "우편번호", address: "주소", memo: "메모",
};

export function statusFor(emp, today) {
  if (emp.retireDate && emp.retireDate <= today) return "퇴직";
  return emp.status === "휴직" ? "휴직" : "재직";
}

export function newEmployee(fields, today) {
  const e = { position: "", employmentType: "정규직", location: "", disability: "", memo: "", status: "재직", ...fields };
  e.status = statusFor(e, today);
  return e;
}

export function diffFields(before, after, fields = TRACKED) {
  const changes = {};
  for (const f of fields) {
    const a = before[f] ?? "", b = after[f] ?? "";
    if (a !== b) changes[f] = { before: a, after: b };
  }
  return changes;
}

// 변경 이력 1건 = 항목 하나. date는 변경 효력일(퇴사는 퇴사일, 그 외 반영일).
export function historyEntries(empNo, changes, date) {
  return Object.entries(changes).map(([field, c]) => ({
    empNo, field, before: c.before, after: c.after,
    date: field === "status" && c.after === "퇴직" && changes.retireDate?.after ? changes.retireDate.after : date,
  }));
}

// 명부를 기존 사원에 병합: 명부 항목만 덮어쓰고 앱 전용 항목(직책·고용형태·근무지·장애·메모·휴직)은 보존
export function mergeRoster(existingByNo, parsed, today) {
  const creates = [], updates = [];
  let unchanged = 0;
  const seen = new Set();
  for (const p of parsed) {
    if (seen.has(p.empNo)) continue;
    seen.add(p.empNo);
    const old = existingByNo[p.empNo];
    if (!old) { creates.push(newEmployee(p, today)); continue; }
    const next = { ...old, ...p };
    if (old.retireDate && !p.retireDate && old.status === "퇴직") next.status = "재직"; // 재입사·퇴사 취소
    next.status = statusFor(next, today);
    const changes = diffFields(old, next, [...ROSTER_FIELDS, "status"]);
    if (Object.keys(changes).length) updates.push({ empNo: p.empNo, next, changes });
    else unchanged += 1;
  }
  return { creates, updates, unchanged };
}

// ---------- 시점 속성 ----------
export function groupHistory(history) {
  const by = {};
  for (const h of history) (by[h.empNo] ||= []).push(h);
  for (const k in by) by[k].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.at || 0) - (a.at || 0));
  return by;
}

// date 시점의 값: 현재 값에서 date 이후 변경을 거꾸로 되돌린다
export function attrAt(emp, field, date, histByEmp) {
  let v = emp[field] ?? "";
  for (const h of histByEmp[emp.empNo] || []) {
    if (h.field !== field) continue;
    if (h.date > date) v = h.before ?? ""; else break;
  }
  return v;
}

export function employedAt(emp, date) {
  return !!emp.joinDate && emp.joinDate <= date && (!emp.retireDate || emp.retireDate > date);
}

// ---------- 통계 항목 ----------
const band = (v, edges, labels) => { if (v === null) return "미상"; const i = edges.findIndex((e) => v < e); return labels[i === -1 ? labels.length - 1 : i]; };
export const AGE_BANDS = ["20세 미만", "20대", "30대", "40대", "50대", "60세 이상"];
export const TENURE_BANDS = ["1년 미만", "1~3년", "3~5년", "5~10년", "10년 이상"];

// get(emp, ctx): ctx = { date(평가일), hist, settings }
export const DIMENSIONS = [
  { key: "dept", label: "부서", get: (e, c) => attrAt(e, "dept", c.date, c.hist) },
  { key: "orgParent", label: "상위조직", get: (e, c) => orgParentOf(attrAt(e, "dept", c.date, c.hist), c.settings) },
  { key: "grade", label: "직급", get: (e, c) => attrAt(e, "grade", c.date, c.hist) },
  { key: "position", label: "직책", get: (e, c) => attrAt(e, "position", c.date, c.hist) || "팀원" },
  { key: "jobType", label: "직종", get: (e, c) => attrAt(e, "jobType", c.date, c.hist) },
  { key: "employmentType", label: "고용형태", get: (e, c) => attrAt(e, "employmentType", c.date, c.hist) },
  { key: "location", label: "근무지", get: (e, c) => attrAt(e, "location", c.date, c.hist) },
  { key: "gender", label: "성별", get: (e) => e.gender },
  { key: "foreigner", label: "내외국인", get: (e) => e.foreigner || "내국인" },
  { key: "nationality", label: "국적", get: (e) => e.nationality },
  { key: "disability", label: "장애", get: (e) => e.disability || "비장애" },
  { key: "status", label: "재직상태", get: (e, c) => (employedAt(e, c.at) ? (attrAt(e, "status", c.at, c.hist) === "휴직" ? "휴직" : "재직") : e.joinDate > c.at ? "입사 전" : "퇴직") },
  { key: "ageBand", label: "연령대", get: (e, c) => band(ageAt(e.birthDate, c.date), [20, 30, 40, 50, 60], AGE_BANDS) },
  { key: "tenureBand", label: "근속구간", get: (e, c) => band(tenureAt(e, c.date), [1, 3, 5, 10], TENURE_BANDS) },
  { key: "joinYear", label: "입사연도", get: (e) => (e.joinDate || "").slice(0, 4) },
  { key: "joinMonth", label: "입사월", get: (e) => (e.joinDate || "").slice(0, 7) },
  { key: "retireYear", label: "퇴사연도", get: (e) => (e.retireDate || "").slice(0, 4) },
  { key: "retireMonth", label: "퇴사월", get: (e) => (e.retireDate || "").slice(0, 7) },
];
export const DIM = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d]));

export const METRICS = [
  { key: "count", label: "인원" },
  { key: "ratio", label: "구성비(%)" },
  { key: "avgAge", label: "평균 연령" },
  { key: "avgTenure", label: "평균 근속(년)" },
  { key: "hires", label: "입사 수" },
  { key: "exits", label: "퇴사 수" },
  { key: "exitRate", label: "퇴사율(%)" },
];
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));

export function orgParentOf(dept, settings) {
  const units = settings?.orgUnits || [];
  const byName = Object.fromEntries(units.map((u) => [u.name, u]));
  let cur = byName[dept];
  if (!cur) return dept || "";
  while (cur.parent && byName[cur.parent]) cur = byName[cur.parent];
  return cur.name;
}

// ---------- 피벗 ----------
// config: { mode: "point"|"trend"|"list", date, from, fromMonth, toMonth, rows, cols, metrics:[...], filters:[{dim, op:"in"|"not", values}] }
const EMPTY = "(없음)";
const keyOf = (v) => (v === "" || v === null || v === undefined ? EMPTY : String(v));

function evalDate(e, date) { // 퇴직자는 퇴직 전날 기준 소속으로 본다
  return e.retireDate && e.retireDate <= date ? addDays(e.retireDate, -1) : date;
}

function passFilters(e, ctx, filters) {
  return (filters || []).every((f) => {
    if (!f.values?.length || !DIM[f.dim]) return true;
    const v = keyOf(DIM[f.dim].get(e, ctx));
    const hit = f.values.includes(v);
    return f.op === "not" ? !hit : hit;
  });
}

function makeCtx(e, date, hist, settings) { return { date: evalDate(e, date), at: date, hist, settings }; }

// 한 기간(from~to, to=기준일)에서 칸별 원자료를 모은다
function collect(employees, hist, settings, cfg, to, from, rowDim, colDim) {
  const cells = new Map();
  const cell = (r, c) => {
    const k = `${r}\u0001${c}`;
    if (!cells.has(k)) cells.set(k, { r, c, employed: [], hires: [], exits: [], atFrom: 0, ageSum: 0, ageN: 0, tenSum: 0, tenN: 0 });
    return cells.get(k);
  };
  const dayBeforeFrom = addDays(from, -1);
  for (const e of employees) {
    const ctx = makeCtx(e, to, hist, settings);
    if (!passFilters(e, ctx, cfg.filters)) continue;
    const r = rowDim ? keyOf(DIM[rowDim].get(e, ctx)) : "전체";
    const c = colDim ? keyOf(DIM[colDim].get(e, ctx)) : "";
    const isEmp = employedAt(e, to);
    const hired = e.joinDate >= from && e.joinDate <= to;
    const exited = !!e.retireDate && e.retireDate >= from && e.retireDate <= to;
    const atFrom = employedAt(e, dayBeforeFrom);
    if (!isEmp && !hired && !exited && !atFrom) continue;
    const x = cell(r, c);
    if (isEmp) {
      x.employed.push(e);
      const a = ageAt(e.birthDate, to); if (a !== null) { x.ageSum += a; x.ageN += 1; }
      const t = tenureAt(e, to); if (t !== null) { x.tenSum += t; x.tenN += 1; }
    }
    if (hired) x.hires.push(e);
    if (exited) x.exits.push(e);
    if (atFrom) x.atFrom += 1;
  }
  return cells;
}

function sumCells(list) {
  const s = { employed: [], hires: [], exits: [], atFrom: 0, ageSum: 0, ageN: 0, tenSum: 0, tenN: 0 };
  for (const x of list) {
    s.employed.push(...x.employed); s.hires.push(...x.hires); s.exits.push(...x.exits);
    s.atFrom += x.atFrom; s.ageSum += x.ageSum; s.ageN += x.ageN; s.tenSum += x.tenSum; s.tenN += x.tenN;
  }
  return s;
}

const round1 = (v) => Math.round(v * 10) / 10;
export function metricValue(metric, x, grandEmployed) {
  switch (metric) {
    case "count": return x.employed.length;
    case "ratio": return grandEmployed ? round1((x.employed.length / grandEmployed) * 100) : 0;
    case "avgAge": return x.ageN ? round1(x.ageSum / x.ageN) : null;
    case "avgTenure": return x.tenN ? round1(x.tenSum / x.tenN) : null;
    case "hires": return x.hires.length;
    case "exits": return x.exits.length;
    case "exitRate": { const avg = (x.atFrom + x.employed.length) / 2; return avg ? round1((x.exits.length / avg) * 100) : 0; }
    default: return null;
  }
}

export function metricMembers(metric, x) {
  return metric === "hires" ? x.hires : metric === "exits" || metric === "exitRate" ? x.exits : x.employed;
}

function orderKeys(keys, dim, settings) {
  const order = { dept: (settings?.orgUnits || []).map((u) => u.name), orgParent: (settings?.orgUnits || []).map((u) => u.name),
    grade: settings?.grades, position: settings?.positions, jobType: settings?.jobTypes, employmentType: settings?.employmentTypes,
    location: settings?.locations, ageBand: AGE_BANDS, tenureBand: TENURE_BANDS, status: ["재직", "휴직", "퇴직", "입사 전"] }[dim] || [];
  const idx = (k) => { const i = order.indexOf(k); return i === -1 ? (k === EMPTY ? 1e9 : 1e6) : i; };
  return [...keys].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b, "ko"));
}

// 결과: { rowKeys, colKeys, value(r,c), members(r,c), rowLabel, colLabel }  (총계 키 = "합계")
export function pivot(employees, history, settings, cfg) {
  const hist = groupHistory(history);
  const metrics = cfg.metrics?.length ? cfg.metrics : ["count"];
  if (cfg.mode === "trend") return pivotTrend(employees, hist, settings, cfg, metrics);
  const to = cfg.date;
  const from = cfg.from || `${to.slice(0, 4)}-01-01`;
  const colDim = cfg.cols || "";
  const cells = collect(employees, hist, settings, cfg, to, from, cfg.rows || "", colDim);
  const all = [...cells.values()];
  const grand = sumCells(all).employed.length;
  const rowKeys = orderKeys(new Set(all.map((x) => x.r)), cfg.rows, settings);
  const pick = (r, c) => all.filter((x) => (r === "합계" || x.r === r) && (c === "합계" || x.c === c));
  if (colDim) {
    const metric = metrics[0];
    const colKeys = orderKeys(new Set(all.map((x) => x.c)), colDim, settings);
    return { rowKeys, colKeys, metric, colsAreMetrics: false,
      value: (r, c) => metricValue(metric, sumCells(pick(r, c)), grand),
      members: (r, c) => metricMembers(metric, sumCells(pick(r, c))) };
  }
  return { rowKeys, colKeys: metrics, colsAreMetrics: true,
    value: (r, m) => (m === "합계" ? null : metricValue(m, sumCells(pick(r, "합계")), grand)),
    members: (r, m) => metricMembers(m, sumCells(pick(r, "합계"))) };
}

function pivotTrend(employees, hist, settings, cfg, metrics) {
  const months = monthsBetween(cfg.fromMonth, cfg.toMonth);
  const rowDim = cfg.rows || "";
  const perMonth = months.map((ym) => {
    const to = monthEnd(ym), from = `${ym}-01`;
    const cells = [...collect(employees, hist, settings, cfg, to, from, rowDim, "").values()];
    return { ym, cells, grand: sumCells(cells).employed.length };
  });
  const useMetricRows = !rowDim;
  const rowKeys = useMetricRows ? metrics : orderKeys(new Set(perMonth.flatMap((p) => p.cells.map((x) => x.r))), rowDim, settings);
  const metric = metrics[0];
  const at = (r, ym) => perMonth.find((p) => p.ym === ym);
  const sel = (p, r) => sumCells(useMetricRows || r === "합계" ? p.cells : p.cells.filter((x) => x.r === r));
  return { rowKeys, colKeys: months, metric, rowsAreMetrics: useMetricRows, trend: true,
    value: (r, ym) => { if (ym === "합계") return null; const p = at(r, ym); return metricValue(useMetricRows ? r : metric, sel(p, r), p.grand); },
    members: (r, ym) => { const p = at(r, ym); return p ? metricMembers(useMetricRows ? r : metric, sel(p, r)) : []; } };
}

// 상세 명부(list 모드): 기준일 재직자 중 조건 통과
export function listMembers(employees, history, settings, cfg) {
  const hist = groupHistory(history);
  return employees.filter((e) => {
    const ctx = makeCtx(e, cfg.date, hist, settings);
    const statusFilter = (cfg.filters || []).some((f) => f.dim === "status" && f.values?.length);
    return (statusFilter || employedAt(e, cfg.date)) && passFilters(e, ctx, cfg.filters);
  });
}

// ---------- 기본 저장 보기 ----------
export function defaultViews(today) {
  const y = today.slice(0, 4), ym = today.slice(0, 7);
  const back = monthsBetween(`${Number(y) - 1}-${today.slice(5, 7)}`, ym).slice(1)[0] || ym;
  return [
    { name: "직종별 인원", star: true, config: { mode: "point", rows: "jobType", cols: "gender", metrics: ["count"], filters: [] } },
    { name: "장애인·외국인", star: false, config: { mode: "point", rows: "disability", cols: "foreigner", metrics: ["count"], filters: [] } },
    { name: "인력 구성(직급×성별)", star: false, config: { mode: "point", rows: "grade", cols: "gender", metrics: ["count"], filters: [] } },
    { name: "입퇴사 추이", star: true, config: { mode: "trend", fromMonth: back, toMonth: ym, rows: "", metrics: ["hires", "exits"], filters: [], chart: "line" } },
    { name: "월별 인원 현황", star: false, config: { mode: "trend", fromMonth: back, toMonth: ym, rows: "dept", metrics: ["count"], filters: [] } },
    { name: "조직별 현황", star: true, config: { mode: "point", rows: "dept", cols: "", metrics: ["count", "avgAge", "avgTenure"], filters: [] } },
    { name: "상세 명부", star: false, config: { mode: "list", filters: [] } },
  ];
}

// ---------- 주민등록번호 암호화 (개인정보 보호법 제24조의2: 암호화 보관) ----------
// 잠금 비밀번호 → PBKDF2(SHA-256, 31만 회) → AES-GCM 256. 비밀번호·원문은 저장하지 않는다.
export const RRN_CHECK = "PEOPLEOPS-RRN-OK";
export const PBKDF2_ITER = 310000;
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newSalt() { return b64(crypto.getRandomValues(new Uint8Array(16))); }

export async function deriveKey(pass, saltB64, iterations = PBKDF2_ITER) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return b64(out);
}

export async function decryptText(key, payload) { // 비밀번호가 틀리면 예외
  const raw = unb64(payload);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  return new TextDecoder().decode(pt);
}

// 명부에서 사번 → 주민번호 13자리(숫자만). 저장용이 아니라 암호화 직전에만 쓴다.
export function extractRrn(rows) {
  const out = {};
  for (const r of rows) {
    const no = clean(r["사원코드"]), d = String(r["주민(외국인)등록번호"] ?? "").replace(/\D/g, "");
    if (no && d.length === 13) out[no] = d;
  }
  return out;
}
export const formatRrn = (d) => (d && d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : "");

// ---------- 기간 비교 ----------
export const COMPARE = { prevMonth: "전월", prevYear: "전년", ytd: "전년 말" };
export function shiftMonths(iso, n) { // 말일은 말일로, 그 외 일자는 해당 월 길이에 맞춰 자른다
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ym = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  const end = monthEnd(ym), isEnd = iso === monthEnd(iso.slice(0, 7));
  return isEnd || d > Number(end.slice(8)) ? end : `${ym}-${String(d).padStart(2, "0")}`;
}
export function compareCfg(cfg) { // 비교 시점 설정(기준일·집계 시작일을 같은 만큼 옮긴다)
  const y = Number(cfg.date.slice(0, 4)), from = cfg.from || `${y}-01-01`;
  const base = { ...cfg, compare: "" };
  if (cfg.compare === "prevMonth") return { ...base, date: shiftMonths(cfg.date, -1), from: shiftMonths(from, -1) };
  if (cfg.compare === "prevYear") return { ...base, date: shiftMonths(cfg.date, -12), from: shiftMonths(from, -12) };
  if (cfg.compare === "ytd") return { ...base, date: `${y - 1}-12-31`, from: `${y - 1}-01-01` };
  return null;
}
// 시점 표(열 = 지표)에 비교 시점 값과 증감을 붙인다
export function pivotCompare(employees, history, settings, cfg) {
  const metrics = cfg.metrics?.length ? cfg.metrics : ["count"];
  const cur = pivot(employees, history, settings, { ...cfg, compare: "", metrics });
  const c2 = compareCfg(cfg), prev = pivot(employees, history, settings, { ...c2, metrics });
  const rowKeys = [...cur.rowKeys, ...prev.rowKeys.filter((k) => !cur.rowKeys.includes(k))];
  const delta = (a, b) => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);
  return { compare: true, label: COMPARE[cfg.compare], prevDate: c2.date, rowKeys, metrics,
    cur: (r, m) => cur.value(r, m), prev: (r, m) => prev.value(r, m), delta: (r, m) => delta(cur.value(r, m), prev.value(r, m)),
    members: (r, m) => cur.members(r, m) };
}
