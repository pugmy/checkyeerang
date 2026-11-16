"use client";

import { useState } from "react";
import { LogoutButton, useAdmin } from "./admin";
import { Modal, useDialogs } from "./modal";
import { DAYS, errText, Loaded, SHIFT, SHIFT_ORDER, useLoad, usePending, type Result } from "./shared";

type User = { id: number; name: string; grade: number; day: number; shift: number };
type Rec = { id: number; userId: number; shift: number; kind: string; detail?: string };
type AdminData = {
  date: string; today: string; day: number; rosterVerified?: boolean;
  records: Rec[]; users: User[];
  rosterByShift?: Record<number, User[]>;
  exempt?: { all?: boolean; grades: Record<number, boolean>; reasons?: { category: string; title: string }[] };
};

const DetailLine = ({ text }: { text: string }) => <p className="detail">특이사항: {text}</p>;
const NameLine = ({ u }: { u: User }) => <span className="bold">{u.name} <span className="name-sub">{u.grade}학년</span></span>;

export default function Attendance({ date, setDate }: { date: string; setDate: (date: string) => void }) {
  const { adminApi } = useAdmin();
  const { ask, notify } = useDialogs();
  const state = useLoad(() => adminApi<AdminData>("api_admin", date), [date]);
  const [csvToday, setCsvToday] = useState<string | null>(null);

  const excuse = async (u: User, d: AdminData, miss: Rec) => {
    if (!(await ask(u.name + " 학생의 " + d.date + " 결석을 면제로 정정할까요?"))) return;
    try {
      const result = await adminApi<Result>("api_excuseAbsence", miss.id);
      if (result.ok) state.reload(); else notify(result.message);
    } catch (e) { notify(errText(e)); }
  };

  return (
    <>
      <Loaded state={state}>{(d) => {
        const title = <div className="between"><h1 className="title">출석 관리</h1><LogoutButton /></div>;
        const picker = (
          <div className="row wrap">
            <input type="date" className="field date" value={d.date} aria-label="날짜 선택"
              onChange={(e) => { if (e.target.value) setDate(e.target.value); }} />
            <button type="button" className="btn ghost" onClick={() => setCsvToday(d.today)}>CSV 내보내기</button>
          </div>
        );
        if (!d.day) {
          return (
            <div className="stack">
              {title}{picker}
              <div className="card big mt5"><p className="bold" style={{ fontSize: "1.1rem" }}>주말에는 정규 당번이 없습니다.</p></div>
            </div>
          );
        }

        const duty = d.records.filter((r) => r.kind === "duty");
        const makeup = d.records.filter((r) => r.kind === "makeup");
        const absent = d.records.filter((r) => r.kind === "absent");
        const excused = d.records.filter((r) => r.kind === "excused");
        const onDuty = d.users.filter((u) => u.day === d.day);
        const madeUp = d.users.filter((u) => makeup.some((r) => r.userId === u.id));

        return (
          <div className="stack">
            {title}{picker}
            {d.rosterVerified === false && (
              <p className="detail" role="note">이력 기록을 시작하기 전 날짜입니다. 당시 당번·학년 정보는 현재 등록 정보가 표시될 수 있습니다.</p>
            )}
            {d.exempt?.all && (
              <p className="school-notice" role="status">
                {d.exempt.reasons?.some((r) => r.category === "exam") ? "시험 기간입니다" : "출석 의무가 없는 날입니다"}
                <small>{(d.exempt.reasons || []).map((r) => r.title).join(" · ")}</small>
              </p>
            )}
            <h2 className="sec mt8">
              {d.date + " "}
              <span className="name-sub" style={{ fontSize: "inherit", fontWeight: 800, color: "var(--brand)" }}>({DAYS[d.day - 1]})</span>
              {" 당번"}
            </h2>
            {SHIFT_ORDER.map((shift) => {
              const members = d.rosterByShift ? (d.rosterByShift[shift] || []) : onDuty.filter((u) => u.shift === shift);
              const present = members.filter((u) => duty.some((r) => r.userId === u.id)).length;
              return (
                <section key={shift} className="mt5">
                  <div className="between" style={{ padding: "0 .25rem .5rem" }}>
                    <h3 className="sub">{SHIFT[shift]}</h3>
                    {members.length > 0 && <span className="muted bold" style={{ fontSize: ".875rem" }}>{present} / {members.length}명 출석</span>}
                  </div>
                  {members.length === 0 ? <p className="card muted">당번 없음</p> : (
                    <ul className="col" style={{ gap: ".5rem" }}>
                      {members.map((u) => {
                        const rec = duty.find((r) => r.userId === u.id && r.shift === shift);
                        const miss = absent.find((r) => r.userId === u.id && r.shift === shift);
                        const corrected = excused.find((r) => r.userId === u.id && r.shift === shift);
                        const exempt = !!d.exempt && (d.exempt.all || d.exempt.grades[u.grade]);
                        const free = !rec && !miss && !corrected && exempt;
                        const review = !!miss && !!exempt;
                        const badge = rec ? "출석" : corrected ? "면제 정정" : review ? "면제 정정 필요" : miss ? "결석" : free ? "면제" : "미출석";
                        const tone = rec ? "ok" : miss && !review ? "bad" : free || corrected || review ? "info" : "idle";
                        return (
                          <li key={u.id} className="card">
                            <div className="between">
                              <NameLine u={u} />
                              <div className="row wrap">
                                <span className={"pill " + tone}>{badge}</span>
                                {review && miss && <button type="button" className="btn ghost sm" onClick={() => excuse(u, d, miss)}>면제 정정</button>}
                              </div>
                            </div>
                            {rec?.detail && <DetailLine text={rec.detail} />}
                            {corrected && <p className="muted">관리자가 면제로 정정한 기록입니다.</p>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
            <h2 className="sec mt10">보충</h2>
            <ul className="col mt3" style={{ gap: ".5rem" }}>
              {madeUp.length === 0 && <li className="card muted">보충 출석 기록이 없습니다.</li>}
              {madeUp.map((u) => (
                <li key={u.id} className="card">
                  <div className="between"><NameLine u={u} /><span className="pill info">보충 완료</span></div>
                  {makeup.filter((r) => r.userId === u.id && r.detail).map((r) => <DetailLine key={r.id} text={r.detail!} />)}
                </li>
              ))}
            </ul>
          </div>
        );
      }}</Loaded>
      {csvToday !== null && <CsvModal today={csvToday} onClose={() => setCsvToday(null)} />}
    </>
  );
}

function CsvModal({ today, onClose }: { today: string; onClose: () => void }) {
  const { adminApi } = useAdmin();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [msg, setMsg] = useState("");
  const [pending, track] = usePending();

  const go = async () => {
    setMsg("");
    if (!from || !to || to < from) { setMsg("종료일은 시작일 이후여야 합니다."); return; }
    let r: Result & { csv?: string; name?: string };
    try { r = await track(() => adminApi<typeof r>("api_csv", from, to)); }
    catch (e) { setMsg(errText(e)); return; }
    if (!r.ok) { setMsg(r.message); return; }
    // BOM을 붙여야 엑셀에서 한글이 깨지지 않는다
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" }));
    a.download = r.name ?? "출석.csv";
    document.body.append(a);
    a.click();
    a.remove();
    onClose();
  };

  return (
    <Modal label="CSV 내보내기" onClose={onClose}>
      <h2 style={{ marginBottom: ".25rem" }}>CSV 내보내기</h2>
      <p className="muted" style={{ fontSize: ".9rem", marginBottom: "1rem" }}>선택한 기간의 정규 출석과 보충 출석을 내려받습니다.</p>
      <div className="col" style={{ gap: ".75rem" }}>
        <label className="label">시작일<input type="date" className="field" aria-label="시작일" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="label">종료일<input type="date" className="field" aria-label="종료일" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <p className="msg bad-text" role="status">{msg}</p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onClose}>취소</button>
        <button type="button" className="btn primary" disabled={pending} onClick={go}>{pending ? "만드는 중..." : "내려받기"}</button>
      </div>
    </Modal>
  );
}
