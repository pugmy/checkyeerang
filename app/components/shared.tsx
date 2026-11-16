"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";

export const DAYS = ["월", "화", "수", "목", "금"];
export const SHIFT: Record<number, string> = { 1: "점심 전", 3: "점심 후", 2: "저녁" };
export const TIME: Record<number, string> = { 1: "12:30 ~ 13:00", 3: "13:00 ~ 13:20", 2: "18:00 ~ 18:20" };
export const SHIFT_ORDER = [1, 3, 2];
export const todayKST = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export type Result = { ok: boolean; message: string };

// 서버 함수 호출: /api/rpc로 보낸다. 실패하면 서버가 준 메시지로 reject한다.
export async function api<T>(fn: string, ...args: unknown[]): Promise<T> {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fn, args }),
  });
  const data = await res.json().catch(() => null);
  if (!data || data.error !== undefined) throw new Error((data && data.error) || "요청 실패");
  return data.result as T;
}

const messageOf = (e: unknown) => String((e as Error | null)?.message ?? e ?? "");
export const isAuthError = (e: unknown) => /관리자 로그인|로그인이 만료/.test(messageOf(e));
export const errText = (e: unknown) =>
  isAuthError(e) ? "관리자 로그인이 만료됐습니다. 다시 로그인해 주세요." : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

// 요청 중에는 버튼을 잠그고 문구를 바꾸는 데 쓴다. track으로 감싼 동안만 pending이 true다.
export function usePending() {
  const [pending, setPending] = useState(false);
  const track = useCallback(async <T,>(fn: () => Promise<T>) => {
    setPending(true);
    try { return await fn(); } finally { setPending(false); }
  }, []);
  return [pending, track] as const;
}

export type Load<T> = { data: T | undefined; error: unknown; reload: () => void };

// 화면 데이터를 불러온다. 다시 불러오는 동안에는 이전 데이터를 그대로 보여 줘서, 위에 떠 있는 창이 닫히지 않게 한다.
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    load().then(
      (value) => { if (alive) { setData(value); setError(null); } },
      (e) => { if (alive) setError(e); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

export function Skeleton({ heights = ["1.5rem", "9rem", "3rem"] }: { heights?: string[] }) {
  return (
    <div role="status" aria-label="불러오는 중" className="stack" style={{ gap: ".75rem" }}>
      {heights.map((height, i) => <div key={i} className="skeleton" aria-hidden="true" style={{ height }} />)}
    </div>
  );
}

export function Loaded<T>({ state, children }: { state: Load<T>; children: (data: T) => ReactNode }) {
  if (state.error) {
    return (
      <div className="card big">
        <p className="bad-text bold">{errText(state.error)}</p>
        <button type="button" className="btn ghost mt4" onClick={state.reload}>다시 시도</button>
      </div>
    );
  }
  if (state.data === undefined) return <Skeleton />;
  return <>{children(state.data)}</>;
}

function Icon({ d, className, style }: { d: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={className} style={style}>
      <path d={d} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export const CheckIcon = () => <Icon d="M4 10.5l4 4 8-9" className="check-pop" />;
export const Chevron = () => <Icon d="M5 8l5 5 5-5" style={{ width: "1rem", height: "1rem", color: "var(--muted)" }} />;

export function Choice<V extends string | number>({ label, options, value, onChange }: {
  label: string; options: { value: V; label: string }[]; value: V; onChange: (value: V) => void;
}) {
  return (
    <div className="label" role="group" aria-label={label}>
      {label}
      <div className="row">
        {options.map((o) => (
          <button key={o.value} type="button" className="choice" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const msgClass = (msg: { ok: boolean } | null) => "msg" + (msg ? (msg.ok ? " ok-text" : " bad-text") : "");
