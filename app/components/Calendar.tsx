"use client";

import { useEffect, useState } from "react";
import { AdminLogin, LogoutButton, useAdmin } from "./admin";
import { Modal, useDialogs } from "./modal";
import { SchoolRules } from "./SchoolRules";
import { api, errText, Loaded, todayKST, useLoad, usePending, type Result } from "./shared";

type Reason = { category: string; title: string; lead?: boolean; grades?: string };
type Note = { id: number; category: string; title: string; detail?: string; name?: string };
type Day = {
  date: string; inMonth: boolean; verified: boolean; needsReview?: boolean;
  slots: { shift: number; members: { name: string }[] }[];
  notes: Note[];
  records: { name: string; kind: string }[];
  school?: { all?: boolean; reasons: Reason[] };
};
type MonthData = { ok: boolean; message?: string; month: string; days: Day[] };

// 달력 선·상세 목록에 쓰는 면제 사유 이름. 학년별 행사는 대상 학년을 붙인다.
const schoolLabel = (r: Reason) => r.category === "exam" ? (r.lead ? "시험 기간" : "시험") + " · " + r.title
  : r.category === "event" ? "행사 · " + r.title + " (" + (r.grades ?? "").replace(/,/g, "·") + "학년)"
  : "휴업 · " + r.title;
const CALENDAR_LABELS: Record<string, string> = { activity: "활동·행사", makeup_plan: "보충 예정", notice: "메모" };
const RECORD_LABELS: Record<string, string> = { duty: "출석 완료", makeup: "보충 완료", absent: "결석" };
const SHIFT_NAMES: Record<number, string> = { 1: "점심 전", 3: "점심 후", 2: "저녁" };

export function calendarMove(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}

// 휴업·시험 일정을 같은 이름끼리 연속된 날짜로 묶어 선(bar)으로 그린다. 이름이 다른 일정은 줄(lane)과 색이 다르다.
type Bar = { label: string; lane: number; from: number; to: number; color: number };
function layoutBars(days: Day[]) {
  const events: Bar[] = [], open = new Map<string, Bar>(), lanes: number[] = [];
  days.forEach((day, i) => {
    const keys = new Set<string>();
    if (day.inMonth) for (const r of day.school?.reasons || []) {
      const kind = r.category === "exam" ? (r.lead ? "lead" : "exam") : r.category === "event" ? "event" : "closed";
      const key = kind + "|" + r.title + "|" + (r.grades || "");
      keys.add(key);
      let ev = open.get(key);
      if (!ev) {
        let lane = lanes.findIndex((end) => end < i);
        if (lane < 0) lane = lanes.length;
        ev = { label: schoolLabel(r), lane, from: i, to: i, color: events.length % 5 };
        open.set(key, ev); events.push(ev);
      }
      ev.to = i;
      lanes[ev.lane] = i;
    }
    for (const key of [...open.keys()]) if (!keys.has(key)) open.delete(key);
  });
  return { events, lanes };
}

export default function Calendar({ month, setMonth, selected, setSelected, onShowAttendance }: {
  month: string; setMonth: (month: string) => void;
  selected: string; setSelected: (date: string) => void;
  onShowAttendance: (date: string) => void;
}) {
  const { token, adminApi } = useAdmin();
  const { ask, notify } = useDialogs();
  const state = useLoad(async () => {
    const data = await api<MonthData>("api_calendarMonth", month);
    if (!data.ok) throw new Error(data.message || "달력을 불러오지 못했습니다.");
    return data;
  }, [month]);
  const [needLogin, setNeedLogin] = useState(false);
  const [noteDate, setNoteDate] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 달력은 누구나 보지만 추가·삭제·일정 관리는 로그인 후에만. 로그인 전이면 로그인 화면을 거쳐 달력으로 돌아온다.
  const needAdmin = (action: () => void) => { if (token) action(); else setNeedLogin(true); };
  if (needLogin && !token) return <AdminLogin onDone={() => setNeedLogin(false)} />;

  const remove = (note: Note) => needAdmin(async () => {
    if (!(await ask("이 일정을 삭제할까요?"))) return;
    try {
      const res = await adminApi<Result>("api_calendarDelete", note.id);
      if (res.ok) state.reload(); else notify(res.message);
    } catch (e) { notify(errText(e)); }
  });

  // 선택한 날짜가 이 달에 없으면 오늘, 그것도 없으면 그 달의 첫날을 고른다.
  const pick = (days: Day[]) => days.some((d) => d.date === selected && d.inMonth) ? selected
    : days.find((d) => d.date === todayKST() && d.inMonth)?.date || days.find((d) => d.inMonth)?.date || "";

  return (
    <>
      <Loaded state={state}>{(data) => {
        const current = pick(data.days);
        const { events, lanes } = layoutBars(data.days);
        const bars = (i: number) => lanes.map((_, lane) => {
          const ev = events.find((e) => e.lane === lane && e.from <= i && i <= e.to);
          if (!ev) return <span key={lane} className="cal-bar empty" aria-hidden="true" />;
          const first = i === ev.from || i % 7 === 0, last = i === ev.to || i % 7 === 6;
          return (
            <span key={lane} className={"cal-bar c" + ev.color + (first ? " first" : "") + (last ? " last" : "")} title={ev.label}>
              {first ? ev.label : null}
            </span>
          );
        });
        const day = data.days.find((d) => d.date === current);
        return (
          <div className="stack">
            <div className="between">
              <div>
                <h1 className="title">도서관 일정</h1>
                <p className="muted">날짜를 선택해 당번과 행사, 보충 예정 및 출석 기록을 확인하세요.</p>
              </div>
              <div className="row wrap">
                <button className="btn ghost sm" type="button" onClick={() => needAdmin(() => setRulesOpen(true))}>일정 관리</button>
                {token ? <LogoutButton /> : null}
              </div>
            </div>
            <div className="calendar-toolbar">
              <button type="button" className="btn ghost sm" onClick={() => setMonth(calendarMove(month, -1))}>이전 달</button>
              <h2 className="sub">{data.month.replace("-", "년 ") + "월"}</h2>
              <button type="button" className="btn ghost sm" onClick={() => setMonth(calendarMove(month, 1))}>다음 달</button>
            </div>
            <div className="calendar-scroll" tabIndex={0}>
              <div className="calendar-grid" role="group" aria-label={data.month + " 월간 달력"}>
                {["월", "화", "수", "목", "금", "토", "일"].map((w) => <span key={w} className="calendar-weekday">{w}</span>)}
                {data.days.map((d, i) => {
                  // 다른 달 날짜는 칸만 남기고 비워서, 달마다 달력 크기가 달라지지 않게 한다.
                  if (!d.inMonth) return <div key={d.date} className="calendar-day other-month" aria-hidden="true" />;
                  const names = d.verified ? d.slots.flatMap((slot) => slot.members.map((m) => m.name)) : [];
                  return (
                    <button key={d.date} type="button" className="calendar-day"
                      aria-label={d.date + " · 당번 " + names.length + "명 · 일정 " + d.notes.length + "건"}
                      aria-pressed={d.date === current} onClick={() => setSelected(d.date)}>
                      <span className="calendar-day-number">{Number(d.date.slice(-2))}</span>
                      {lanes.length ? <span className="cal-bars">{bars(i)}</span> : null}
                      {names.length ? (
                        <span className="calendar-day-names">
                          {names.slice(0, 2).join(", ") + (names.length > 2 ? " 외 " + (names.length - 2) + "명" : "")}
                        </span>
                      ) : null}
                      {d.notes.length ? <span className="calendar-day-note">일정 {d.notes.length}</span> : null}
                      {d.records.some((r) => r.kind === "makeup") ? <span className="calendar-day-record">보충 완료</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <section className="calendar-details" aria-live="polite">
              {day && (
                <DayDetail day={day} onShowAttendance={() => onShowAttendance(day.date)}
                  onAdd={() => needAdmin(() => setNoteDate(day.date))} onDelete={remove} />
              )}
            </section>
            <p className="muted">행사와 보충 예정은 일정 표시이며, 출석 인정이나 결석 면제에 자동 반영되지 않습니다.</p>
          </div>
        );
      }}</Loaded>
      {noteDate && <NoteModal date={noteDate} onClose={() => setNoteDate(null)} onSaved={() => { setNoteDate(null); state.reload(); }} />}
      {rulesOpen && (
        <SchoolRules defaultDate={state.data ? pick(state.data.days) : selected}
          onChanged={state.reload} onClose={() => setRulesOpen(false)} />
      )}
    </>
  );
}

function DayDetail({ day, onShowAttendance, onAdd, onDelete }: {
  day: Day; onShowAttendance: () => void; onAdd: () => void; onDelete: (note: Note) => void;
}) {
  // 휴업·공휴일·시험 일정(NEIS에서 가져왔거나 일정 관리에서 등록한 것)도 같은 목록에 읽기 전용으로 보여 준다.
  const reasons = day.school?.reasons || [];
  return (
    <>
      <div className="between">
        <h2 className="sub">{day.date} 일정</h2>
        <div className="row wrap">
          <button className="btn ghost sm" type="button" onClick={onShowAttendance}>출석 기록 보기</button>
          <button className="btn primary sm" type="button" onClick={onAdd}>+ 일정 추가</button>
        </div>
      </div>
      {day.school?.all && (
        <p className="school-notice" role="note">
          {reasons.some((r) => r.category === "exam") ? "시험 기간입니다" : "출석 의무가 없는 날입니다"}
        </p>
      )}
      {day.needsReview && <p className="bad-text" role="note">이 날짜에 면제 대상 결석 기록이 있습니다. 출석 관리에서 확인해 주세요.</p>}
      {!day.verified && <p className="muted">이력 도입 전 시간표는 확인되지 않습니다.</p>}
      <h3 className="calendar-detail-title">정규 당번</h3>
      <ul className="calendar-detail-list">
        {day.slots.map((slot) => (
          <li key={slot.shift} className="calendar-detail-row">
            <span className="bold">{SHIFT_NAMES[slot.shift]}</span>
            <span>{day.verified ? (slot.members.length ? slot.members.map((m) => m.name).join(", ") : "—") : "이력 미확인"}</span>
          </li>
        ))}
      </ul>
      <h3 className="calendar-detail-title">등록된 일정</h3>
      <ul className="calendar-detail-list">
        {reasons.length + day.notes.length ? (
          <>
            {reasons.map((r, i) => <li key={"s" + i} className="calendar-detail-row"><span>{schoolLabel(r)}</span></li>)}
            {day.notes.map((note) => (
              <li key={note.id} className="calendar-detail-row">
                <span>
                  {CALENDAR_LABELS[note.category] + " · " + (note.name ? note.name + " · " : "") + note.title}
                  {note.detail ? <small className="calendar-caption">{note.detail}</small> : null}
                </span>
                <button type="button" className="btn ghost sm" onClick={() => onDelete(note)}>삭제</button>
              </li>
            ))}
          </>
        ) : <li className="muted">등록된 일정이 없습니다.</li>}
      </ul>
      <h3 className="calendar-detail-title">출석 기록</h3>
      <ul className="calendar-detail-list">
        {day.records.length
          ? day.records.map((rec, i) => <li key={i} className="calendar-detail-row">{rec.name + " · " + RECORD_LABELS[rec.kind]}</li>)
          : <li className="muted">출석 기록이 없습니다.</li>}
      </ul>
    </>
  );
}

function NoteModal({ date, onClose, onSaved }: { date: string; onClose: () => void; onSaved: () => void }) {
  const { adminApi } = useAdmin();
  const [category, setCategory] = useState("activity");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [members, setMembers] = useState<{ id: number; name: string; grade: number }[]>([]);
  const [userId, setUserId] = useState("");
  const [info, setInfo] = useState("");
  const [pending, track] = usePending();

  useEffect(() => {
    adminApi<{ id: number; name: string; grade: number; type: number }[]>("api_members").then((users) => {
      const active = users.filter((u) => u.type === 1);
      setMembers(active);
      if (active.length) setUserId(String(active[0].id));
    }).catch(() => setInfo("부원 명단을 불러오지 못했습니다."));
  }, [adminApi]);

  const save = async () => {
    const payload = { date, category, title: title.trim(), detail: detail.trim(), userId: category === "makeup_plan" ? Number(userId) : 0 };
    if (!payload.title) { setInfo("일정 이름을 입력해 주세요."); return; }
    try {
      const res = await track(() => adminApi<Result>("api_calendarAdd", payload));
      if (!res.ok) { setInfo(res.message); return; }
      onSaved();
    } catch (e) { setInfo(errText(e)); }
  };

  return (
    <Modal label="일정 등록" onClose={onClose}>
      <h2>일정 등록</h2>
      <p className="muted">{date}</p>
      <label className="label">
        종류
        <select className="field" aria-label="일정 종류" value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CALENDAR_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="label" hidden={category !== "makeup_plan"}>
        보충 예정 부원
        <select className="field" aria-label="보충 예정 부원" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {members.map((u) => <option key={u.id} value={String(u.id)}>{u.name + " · " + u.grade + "학년"}</option>)}
        </select>
      </label>
      <label className="label">
        일정 이름
        <input className="field" placeholder="일정 이름" maxLength={80} aria-label="일정 이름" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="label">
        메모
        <textarea className="field" rows={3} maxLength={300} placeholder="필요하면 메모를 적어 주세요." aria-label="일정 메모"
          value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <p className="msg bad-text" role="alert">{info}</p>
      <div className="actions">
        <button className="btn ghost" type="button" onClick={onClose}>취소</button>
        <button className="btn primary" type="button" disabled={pending} onClick={save}>{pending ? "저장 중..." : "일정 저장"}</button>
      </div>
    </Modal>
  );
}
