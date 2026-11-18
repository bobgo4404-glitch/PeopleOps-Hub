// 실행: node --test lib.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "./lib.js";

test("날짜 변환", () => {
  assert.equal(L.toISO("20100101"), "2010-01-01");
  assert.equal(L.toISO("2026.3.8"), "2026-03-08");
  assert.equal(L.toISO(""), "");
  assert.equal(L.toISO(46000), "2025-12-09");
  assert.equal(L.monthEnd("2028-02"), "2028-02-29");
  assert.deepEqual(L.monthsBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(L.ageAt("1990-11-19", "2026-11-18"), 35);
  assert.equal(L.ageAt("1990-11-18", "2026-11-18"), 36);
});

test("주민번호에서 생년월일·앞7자리만", () => {
  assert.deepEqual(L.birthFromRrn("780213-1075313"), { birthDate: "1978-02-13", rrnFront7: "780213-1" });
  assert.deepEqual(L.birthFromRrn("050101-4123456"), { birthDate: "2005-01-01", rrnFront7: "050101-4" });
  assert.deepEqual(L.birthFromRrn("900101-5123456").birthDate, "1990-01-01"); // 외국인
});

const row = (o) => ({ 사원코드: "00001", 사원명: "가", 부서: "생산1팀", 입사일자: "20200101", 퇴사일자: "", 직급: "사원",
  직종: "생산직", 성별: "여", 내외국인구분: "내국인", 국가명: "대한민국", "주민(외국인)등록번호": "900101-2000000", 휴대폰번호: "010", 이메일: "--", ...o });

test("명부 변환: 급여·주민번호 전체는 버린다, 필수 열 검사", () => {
  const [e] = L.parseRoster([row({ 건강보험료: 1000, 계좌번호: "123" })]);
  assert.equal(e.joinDate, "2020-01-01");
  assert.equal(e.email, "");
  assert.equal(e.rrnFront7, "900101-2");
  assert.ok(!("계좌번호" in e) && !JSON.stringify(e).includes("900101-2000000"));
  assert.throws(() => L.parseRoster([{ 사원명: "x" }]), /사원코드/);
});

test("병합: 명부 항목만 덮고 앱 전용 항목 보존, 변경 이력 생성", () => {
  const today = "2026-11-18";
  const old = L.newEmployee(L.parseRosterRow(row({})), today);
  old.position = "팀장"; old.status = "휴직";
  const parsed = L.parseRoster([row({ 부서: "생산2팀" }), row({ 사원코드: "00002", 사원명: "나" }), row({ 사원코드: "00003", 사원명: "다" })]);
  const same = L.newEmployee(parsed[2], today);
  const r = L.mergeRoster({ "00001": old, "00003": same }, parsed, today);
  assert.equal(r.creates.length, 1);
  assert.equal(r.unchanged, 1);
  assert.equal(r.updates[0].next.position, "팀장");
  assert.equal(r.updates[0].next.status, "휴직");
  assert.deepEqual(r.updates[0].changes, { dept: { before: "생산1팀", after: "생산2팀" } });
  const h = L.historyEntries("00001", { status: { before: "재직", after: "퇴직" }, retireDate: { before: "", after: "2026-10-31" } }, today);
  assert.equal(h.find((x) => x.field === "status").date, "2026-10-31");
});

test("병합: 퇴사일 들어오면 퇴직, 미래 퇴사일은 재직 유지", () => {
  const today = "2026-11-18";
  const old = L.newEmployee(L.parseRosterRow(row({})), today);
  const r = L.mergeRoster({ "00001": old }, L.parseRoster([row({ 퇴사일자: "20261031" })]), today);
  assert.equal(r.updates[0].next.status, "퇴직");
  const r2 = L.mergeRoster({ "00001": old }, L.parseRoster([row({ 퇴사일자: "20261231" })]), today);
  assert.equal(r2.updates[0].next.status, "재직");
});

test("시점 속성 복원", () => {
  const e = { empNo: "1", dept: "C" };
  const hist = L.groupHistory([
    { empNo: "1", field: "dept", before: "A", after: "B", date: "2026-03-01" },
    { empNo: "1", field: "dept", before: "B", after: "C", date: "2026-09-01" },
  ]);
  assert.equal(L.attrAt(e, "dept", "2026-01-31", hist), "A");
  assert.equal(L.attrAt(e, "dept", "2026-05-31", hist), "B");
  assert.equal(L.attrAt(e, "dept", "2026-09-01", hist), "C");
});

const emps = [
  { empNo: "1", dept: "생산", grade: "사원", gender: "여", joinDate: "2020-01-01", birthDate: "1990-01-01", status: "재직" },
  { empNo: "2", dept: "생산", grade: "대리", gender: "남", joinDate: "2026-03-02", birthDate: "1995-06-01", status: "재직" },
  { empNo: "3", dept: "영업", grade: "과장", gender: "남", joinDate: "2018-05-01", birthDate: "1985-01-01", retireDate: "2026-06-30", status: "퇴직" },
  { empNo: "4", dept: "영업", grade: "사원", gender: "여", joinDate: "2027-01-02", birthDate: "2000-01-01", status: "재직" },
];
const settings = { orgUnits: [{ name: "생산본부", parent: "" }, { name: "생산", parent: "생산본부" }, { name: "영업", parent: "" }] };

test("피벗: 기준일 인원(퇴사일 당일·입사 전 제외), 행×열", () => {
  const p = L.pivot(emps, [], settings, { mode: "point", date: "2026-06-30", rows: "dept", cols: "gender", metrics: ["count"] });
  assert.deepEqual(p.rowKeys, ["생산", "영업"]);
  assert.equal(p.value("생산", "합계"), 2);
  assert.equal(p.value("영업", "남"), 0);
  assert.equal(p.value("합계", "합계"), 2);
  const q = L.pivot(emps, [], settings, { mode: "point", date: "2026-06-29", rows: "dept", metrics: ["count"] });
  assert.equal(q.value("영업", "count"), 1);
});

test("피벗: 입퇴사·퇴사율·평균, 조건, 상위조직", () => {
  const p = L.pivot(emps, [], settings, { mode: "point", date: "2026-12-31", from: "2026-01-01", rows: "", metrics: ["count", "hires", "exits", "exitRate", "avgAge"] });
  assert.equal(p.value("전체", "count"), 2);
  assert.equal(p.value("전체", "hires"), 1);
  assert.equal(p.value("전체", "exits"), 1);
  assert.equal(p.value("전체", "exitRate"), 50); // 퇴사1 / 평균((2+2)/2)
  assert.equal(p.value("전체", "avgAge"), 33.5);
  const f = L.pivot(emps, [], settings, { mode: "point", date: "2026-12-31", rows: "orgParent", metrics: ["count"], filters: [{ dim: "gender", op: "in", values: ["여"] }] });
  assert.deepEqual(f.rowKeys, ["생산본부"]);
  assert.equal(f.members("생산본부", "count")[0].empNo, "1");
});

test("피벗: 과거 시점은 이력으로 부서 복원", () => {
  const hist = [{ empNo: "1", field: "dept", before: "영업", after: "생산", date: "2026-05-01" }];
  const p = L.pivot(emps, hist, settings, { mode: "point", date: "2026-04-30", rows: "dept", metrics: ["count"] });
  assert.equal(p.value("영업", "count"), 2);
});

test("추이: 월말 인원과 월별 입퇴사", () => {
  const p = L.pivot(emps, [], settings, { mode: "trend", fromMonth: "2026-02", toMonth: "2026-07", rows: "", metrics: ["count", "hires", "exits"] });
  assert.deepEqual(p.rowKeys, ["count", "hires", "exits"]);
  assert.equal(p.value("count", "2026-02"), 2);
  assert.equal(p.value("count", "2026-03"), 3);
  assert.equal(p.value("hires", "2026-03"), 1);
  assert.equal(p.value("count", "2026-06"), 2);
  assert.equal(p.value("exits", "2026-06"), 1);
  const d = L.pivot(emps, [], settings, { mode: "trend", fromMonth: "2026-05", toMonth: "2026-07", rows: "dept", metrics: ["count"] });
  assert.equal(d.value("영업", "2026-05"), 1);
  assert.equal(d.value("영업", "2026-07"), 0);
});

test("상세 명부와 기본 보기", () => {
  assert.equal(L.listMembers(emps, [], settings, { mode: "list", date: "2026-11-18", filters: [] }).length, 2);
  const v = L.defaultViews("2026-11-18");
  assert.equal(v.length, 7);
  assert.equal(v[3].config.fromMonth, "2025-12");
});
