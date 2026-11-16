"use client";

import { useEffect, useState } from "react";
import { useAdmin } from "./admin";
import { Modal, useDialogs } from "./modal";
import { errText, todayKST, usePending, type Result } from "./shared";

// ---------- 출석 면제 일정 (휴업·시험·학년별 행사) ----------
type Rule = { id: number; category: string; startDate: string; endDate: string; title: string; grades: string; neisKey?: string };

// 일정 목록 → 수정/등록 창으로 이어지는 흐름. 저장·해제·NEIS 가져오기 뒤에는 onChanged로 달력을 새로 고친다.
export function SchoolRules({ defaultDate, onChanged, onClose }: { defaultDate: string; onChanged: () => void; onClose: () => void }) {
  const { adminApi } = useAdmin();
  const { ask, notify } = useDialogs();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ rule: Rule | null } | null>(null);
  const [syncing, trackSync] = usePending();

  useEffect(() => {
    let alive = true;
    adminApi<Rule[]>("api_schoolRules").then(
      (list) => { if (alive) setRules(list); },
      (e) => { if (alive) { onClose(); notify(errText(e)); } },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (editing) return <RuleEdit rule={editing.rule} defaultDate={defaultDate} onClose={onClose} onSaved={() => { onClose(); onChanged(); }} />;
  if (!rules) return null; // 목록을 받은 뒤에 창을 연다

  const cancel = async (rule: Rule) => {
    if (!(await ask("이 면제 일정을 해제할까요?"))) return;
    let result: Result;
    try { result = await adminApi<Result>("api_schoolRuleCancel", rule.id); }
    catch (e) { result = { ok: false, message: errText(e) }; }
    if (!result.ok) { notify(result.message); return; }
    onClose();
    onChanged();
  };
  const sync = async () => {
    let res: Result;
    try { res = await trackSync(() => adminApi<Result>("api_schoolRulesSync")); }
    catch (e) { res = { ok: false, message: errText(e) }; }
    await notify(res.message);
    if (res.ok) { setVersion((v) => v + 1); onChanged(); }
  };
  const kindLabel = (rule: Rule) =>
    rule.category === "exam" ? "시험" : rule.category === "event" ? "학년별 행사 · " + rule.grades.replace(/,/g, "·") + "학년" : "휴업·방학";

  return (
    <Modal label="일정 관리" onClose={onClose}>
      <h2>일정 관리</h2>
      <p className="muted">휴업일·공휴일·시험 기간은 NEIS에서 자동으로 가져오며, 여기서 수정하거나 해제할 수 있습니다. 시험은 시작일 14일 전부터 면제됩니다.</p>
      <ul className="calendar-detail-list">
        {rules.length ? rules.map((rule) => (
          <li key={rule.id} className="calendar-detail-row">
            <div>
              <strong>{rule.title}</strong>
              <small className="calendar-caption">
                {rule.startDate + (rule.endDate !== rule.startDate ? " ~ " + rule.endDate : "") + " · " + kindLabel(rule) + (rule.neisKey ? " · NEIS" : "")}
              </small>
            </div>
            <div className="row wrap">
              <button type="button" className="btn ghost sm" onClick={() => setEditing({ rule })}>수정</button>
              <button type="button" className="btn ghost sm" onClick={() => cancel(rule)}>해제</button>
            </div>
          </li>
        )) : <li className="muted">등록된 면제 일정이 없습니다.</li>}
      </ul>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
        <button type="button" className="btn ghost" disabled={syncing} onClick={sync}>{syncing ? "가져오는 중..." : "NEIS에서 가져오기"}</button>
        <button type="button" className="btn primary" onClick={() => setEditing({ rule: null })}>+ 일정 등록</button>
      </div>
    </Modal>
  );
}

const TIPS: Record<string, string> = {
  exam: "시험 시작일 14일 전부터 종료일까지 출석 의무가 면제됩니다. 시작일에는 시험 첫날을 입력해 주세요.",
  event: "선택한 학년의 부원만 이 기간에 출석 의무가 면제됩니다. 해외체험학습·대학탐방 등에 사용하세요.",
  closed: "선택한 기간 동안 출석 의무가 면제됩니다. 공휴일·재량휴업일·연휴·방학에 사용하세요.",
};

function RuleEdit({ rule, defaultDate, onClose, onSaved }: { rule: Rule | null; defaultDate: string; onClose: () => void; onSaved: () => void }) {
  const { adminApi } = useAdmin();
  const start0 = rule ? rule.startDate : defaultDate || todayKST();
  const [category, setCategory] = useState(rule?.category ?? "closed");
  const [grades, setGrades] = useState<string[]>(rule ? (rule.grades || "").split(",").filter(Boolean) : []);
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(rule ? rule.endDate : start0);
  const [name, setName] = useState(rule?.title ?? "");
  const [msg, setMsg] = useState("");
  const [pending, track] = usePending();

  const save = async () => {
    const data = { category, startDate: start, endDate: end, title: name.trim(),
      grades: ["1", "2", "3"].filter((g) => grades.includes(g)).join(",") };
    let result: Result;
    try { result = await track(() => adminApi<Result>("api_schoolRuleSave", data, rule?.id || 0)); }
    catch (e) { result = { ok: false, message: errText(e) }; }
    if (!result.ok) { setMsg(result.message); return; }
    onSaved();
  };
  const toggleGrade = (g: string, on: boolean) => setGrades((list) => on ? [...list, g] : list.filter((x) => x !== g));

  return (
    <Modal label="등교·시험 일정 설정" onClose={onClose}>
      <h2>{rule ? "면제 일정 수정" : "면제 일정 등록"}</h2>
      <label className="label">
        종류
        <select className="field" aria-label="면제 일정 종류" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="closed">휴업·방학·공휴일</option>
          <option value="exam">시험</option>
          <option value="event">학년별 행사</option>
        </select>
      </label>
      <div className="label" role="group" aria-label="대상 학년" hidden={category !== "event"}>
        대상 학년
        <div className="row">
          {["1", "2", "3"].map((g) => (
            <label key={g} className="row">
              <input type="checkbox" value={g} checked={grades.includes(g)} onChange={(e) => toggleGrade(g, e.target.checked)} />
              {g}학년
            </label>
          ))}
        </div>
      </div>
      <label className="label">시작일<input className="field" type="date" aria-label="시작일" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <label className="label">종료일<input className="field" type="date" aria-label="종료일" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      <label className="label">
        일정 이름
        <input className="field" maxLength={80} placeholder="예: 2학기 기말고사" aria-label="일정 이름" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="muted" role="note">{TIPS[category] ?? TIPS.closed}</p>
      <p role="alert" className="msg bad-text">{msg}</p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? "저장 중..." : "저장"}</button>
      </div>
    </Modal>
  );
}
