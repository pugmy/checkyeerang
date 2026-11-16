"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";
import { api, CheckIcon, Chevron, errText, Loaded, msgClass, SHIFT, SHIFT_ORDER, TIME, useLoad, usePending, type Result } from "./shared";

type DutyMember = { id: number; name: string; attended?: boolean };
type MakeupMember = { id: number; name: string; grade: number; onDuty?: boolean };
type HomeData = {
  today?: string;
  current?: { shift: number } | null;
  slots?: { shift: number; duty: DutyMember[] }[];
  duty: DutyMember[];
  exemption?: { all?: boolean; reasons?: { category: string; title?: string }[] };
  makeup: MakeupMember[];
};
type Msg = { text: string; ok: boolean } | null;

export default function Home({ viewed, setViewed }: { viewed: number | null; setViewed: (shift: number) => void }) {
  const state = useLoad(() => api<HomeData>("api_home"), []);
  return <Loaded state={state}>{(d) => <HomeView d={d} viewed={viewed} setViewed={(s) => { setViewed(s); state.reload(); }} />}</Loaded>;
}

function HomeView({ d, viewed, setViewed }: { d: HomeData; viewed: number | null; setViewed: (shift: number) => void }) {
  const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(d.today || "") ? new Date(d.today + "T12:00:00+09:00") : new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => displayDate.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", ...o });
  const actual = d.current?.shift || null;
  const selected = viewed !== null && SHIFT_ORDER.includes(viewed) ? viewed : actual || 1;
  const index = SHIFT_ORDER.indexOf(selected);
  const list = d.slots?.find((slot) => slot.shift === selected)?.duty || (actual === selected ? d.duty : []);
  const exempt = d.exemption?.all === true;
  const reasons = d.exemption?.reasons || [];
  const closed = reasons.some((r) => r.category === "closed");
  const exam = reasons.some((r) => r.category === "exam");
  const active = !exempt && actual === selected;

  return (
    <div className="stack home-page">
      <h1 className="sr-only">출석체크</h1>
      <div className="date-title">
        <p className="app-eyebrow">LIBRARY ATTENDANCE</p>
        <p className="y">{fmt({ year: "numeric" })}</p>
        <p className="md">{fmt({ month: "long", day: "numeric" })}<span>{fmt({ weekday: "long" })}</span></p>
      </div>
      <section className="mt4" aria-labelledby="duty-title">
        <div className="slot-viewer">
          <button type="button" className="slot-arrow" disabled={index === 0} aria-label="이전 시간대 보기"
            onClick={() => setViewed(SHIFT_ORDER[index - 1])}>‹</button>
          <div className="slot-viewer-title">
            <h2 className="sub" id="duty-title">{SHIFT[selected]} 당번</h2>
            <span className="pill info">{TIME[selected]}</span>
          </div>
          <button type="button" className="slot-arrow" disabled={index === SHIFT_ORDER.length - 1} aria-label="다음 시간대 보기"
            onClick={() => setViewed(SHIFT_ORDER[index + 1])}>›</button>
        </div>
        {selected !== actual && actual && (
          <button type="button" className="slot-return" onClick={() => setViewed(actual)}>현재 당번으로</button>
        )}
        {exam && (
          <p className="school-notice" role="status">시험 기간입니다<small>시험 준비 기간과 시험 기간에는 당번 출석 의무가 없습니다.</small></p>
        )}
        {!exam && exempt && (
          <p className="school-notice" role="status">
            {closed ? "오늘은 등교하지 않는 날입니다" : "오늘은 출석 의무가 없습니다"}
            {reasons[0]?.title ? <small>{reasons[0].title}</small> : null}
          </p>
        )}
        {!exempt && !actual && (
          <p className="school-notice subtle" role="status">현재는 출석 시간이 아닙니다. 다른 시간대의 담당자는 열람만 할 수 있습니다.</p>
        )}
        {!exempt && actual !== selected && (
          <p className="slot-readonly">다른 시간대의 담당자를 보고 있습니다. 이 화면에서는 출석할 수 없습니다.</p>
        )}
        {list.length ? (
          <ul className="grid2">
            {list.map((m) => (
              <li key={m.id} className="card duty-card">
                <span className="duty-name">{m.name}</span>
                {active ? <AttendButton m={m} /> : (
                  <span className="pill idle" style={{ alignSelf: "center" }}>
                    {exempt ? "출석 면제" : m.attended ? "출석 완료" : "담당자"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card big"><p className="bold">이 시간대에 배정된 부원이 없습니다.</p></div>
        )}
      </section>
      {active && <p className="home-note">본인의 이름을 선택해 출석을 기록해 주세요.</p>}
      {!closed && <Makeup members={d.makeup} />}
    </div>
  );
}

function AttendButton({ m }: { m: DutyMember }) {
  const [done, setDone] = useState(!!m.attended);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ width: "100%" }}>
      {done
        ? <div className="pill ok big" role="status"><CheckIcon />출석 완료</div>
        : <button type="button" className="btn primary lg" onClick={() => setOpen(true)}>출석하기</button>}
      {open && <AttendModal m={m} onDone={() => setDone(true)} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AttendModal({ m, onDone, onClose }: { m: DutyMember; onDone: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [finished, setFinished] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, track] = usePending();

  const confirm = async () => {
    let r: Result;
    try { r = await track(() => api<Result>("api_attend", m.id, text)); }
    catch (e) { r = { ok: false, message: errText(e) }; }
    setMsg({ text: r.message, ok: r.ok });
    setConfirming(false);
    if (r.ok) { setFinished(true); onDone(); }
  };

  return (
    <>
      <Modal label={m.name + " 출석"} onClose={onClose}>
        <h2>{m.name} 출석</h2>
        <label className="label" htmlFor="detail">특이사항</label>
        <textarea className="field mt2" id="detail" maxLength={1000} rows={5} aria-label="특이사항"
          value={text} onChange={(e) => setText(e.target.value)} disabled={finished} />
        <p className="count">{text.length} / 1000</p>
        <p role="status" className={msgClass(msg)}>{msg?.text}</p>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>{finished ? "닫기" : "취소"}</button>
          {!finished && <button type="button" className="btn primary" onClick={() => setConfirming(true)}>출석 기록</button>}
        </div>
      </Modal>
      {confirming && (
        <Modal label="출석 확인" alert narrow canClose={() => !pending} onClose={() => setConfirming(false)}>
          <h3>{m.name} 님, 출석할까요?</h3>
          <p className="detail">특이사항: {text.trim() || "없음"}</p>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>취소</button>
            <button type="button" className="btn primary" disabled={pending} onClick={confirm}>{pending ? "저장 중..." : "확인"}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Makeup({ members }: { members: MakeupMember[] }) {
  const [user, setUser] = useState<MakeupMember | null>(null);
  const [picking, setPicking] = useState(false);
  const [detail, setDetail] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, track] = usePending();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async () => {
    if (!user) return;
    let r: Result;
    try { r = await track(() => api<Result>("api_makeup", user.id, detail)); }
    catch (e) { r = { ok: false, message: errText(e) }; }
    setMsg({ text: r.message, ok: r.ok });
    if (r.ok) setDetail("");
    clearTimeout(timer.current);
    if (r.ok) timer.current = setTimeout(() => setMsg(null), 3000); // 성공 메시지만 사라진다
  };

  return (
    <section className="makeup" aria-labelledby="makeup-title">
      <h2 className="sub" id="makeup-title">보충 출석</h2>
      <p className="muted">정규 당번이 아닌 날의 도서관 활동을 기록합니다.</p>
      <div className="label">
        부원
        <button type="button" className="field" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <span className={user ? undefined : "muted"}>{user ? user.name : "부원 선택"}</span>
          <Chevron />
        </button>
      </div>
      <label className="label">
        특이사항
        <textarea className="field" maxLength={1000} rows={3} aria-label="특이사항" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <p role="status" className={msgClass(msg)} style={{ margin: 0 }}>{msg?.text}</p>
      <button type="button" className="btn primary" disabled={!user || pending} onClick={submit}>{pending ? "저장 중..." : "보충 기록"}</button>
      {picking && (
        <Modal label="부원 선택" onClose={() => setPicking(false)}>
          <h2>부원 선택</h2>
          <div className="col">
            {[1, 2, 3].map((g) => {
              const inGrade = members.filter((m) => m.grade === g);
              return (
                <div key={g} role="group" aria-label={g + "학년"}>
                  <p className="muted bold mt2">{g}학년</p>
                  {inGrade.length ? (
                    <div className="row wrap">
                      {inGrade.map((m) => (
                        <button key={m.id} type="button" className="choice auto" disabled={m.onDuty} aria-pressed={user?.id === m.id}
                          onClick={() => { setUser(m); setPicking(false); }}>
                          {m.name}
                          {m.onDuty && <span style={{ fontSize: ".75rem", fontWeight: 400, marginLeft: ".25rem" }}>(현재 당번)</span>}
                        </button>
                      ))}
                    </div>
                  ) : <p className="muted" style={{ fontSize: ".9rem" }}>부원 없음</p>}
                </div>
              );
            })}
          </div>
          <div className="actions"><button type="button" className="btn ghost" onClick={() => setPicking(false)}>닫기</button></div>
        </Modal>
      )}
    </section>
  );
}
