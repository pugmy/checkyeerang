"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ---------- 모달 (바깥 클릭·Esc로 닫힘, 맨 위 모달만 닫는다) ----------
type Entry = { box: HTMLDivElement; tryClose: () => void };
const stack: Entry[] = [];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const focusables = (box: HTMLElement) =>
  Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.getClientRects().length && el.getAttribute("aria-hidden") !== "true");

function onKeyDown(e: KeyboardEvent) {
  const active = stack[stack.length - 1];
  if (!active) return;
  if (e.key === "Escape") {
    e.preventDefault();
    active.tryClose();
  } else if (e.key === "Tab") {
    // 중첩 확인창에서도 현재 가장 위에 있는 모달 안에서만 이동한다.
    const list = focusables(active.box);
    if (!list.length) { e.preventDefault(); active.box.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    const inside = active.box.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }
}

export function Modal({ label, narrow, alert, className, canClose, onClose, children }: {
  label: string; narrow?: boolean; alert?: boolean; className?: string;
  canClose?: () => boolean; onClose: () => void; children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ canClose, onClose });
  useEffect(() => { latest.current = { canClose, onClose }; });
  const entry = useRef<Entry | null>(null);

  useEffect(() => {
    const box = boxRef.current!;
    const opener = document.activeElement as HTMLElement | null;
    const mine: Entry = { box, tryClose: () => { const l = latest.current; if (!l.canClose || l.canClose()) l.onClose(); } };
    entry.current = mine;
    stack.push(mine);
    if (stack.length === 1) document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modal-open");
    (focusables(box)[0] ?? box).focus();
    return () => {
      const index = stack.indexOf(mine);
      if (index !== -1) stack.splice(index, 1);
      if (!stack.length) document.removeEventListener("keydown", onKeyDown);
      document.body.classList.toggle("modal-open", stack.length > 0);
      if (opener?.isConnected) opener.focus();
      else stack[stack.length - 1]?.box.focus();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) entry.current?.tryClose(); }}>
      <div ref={boxRef} className={"modal" + (narrow ? " narrow" : "") + (className ? " " + className : "")}
        role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------- 확인창 ----------
// 브라우저 기본 alert/confirm 대신 쓰는 모달. ask는 확인하면 true, 취소·바깥 클릭·Esc면 false.
type Pending = { id: number; message: string; withCancel: boolean; resolve: (value: boolean) => void };
type Dialogs = { ask: (message: string) => Promise<boolean>; notify: (message: string) => Promise<boolean> };
const DialogContext = createContext<Dialogs | null>(null);
let nextId = 0;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Pending[]>([]);
  const open = useCallback((message: string, withCancel: boolean) =>
    new Promise<boolean>((resolve) => setItems((list) => [...list, { id: ++nextId, message, withCancel, resolve }])), []);
  const value = useMemo(() => ({ ask: (m: string) => open(m, true), notify: (m: string) => open(m, false) }), [open]);
  const finish = (item: Pending, result: boolean) => {
    item.resolve(result);
    setItems((list) => list.filter((x) => x !== item));
  };
  return (
    <DialogContext value={value}>
      {children}
      {items.map((item) => (
        <Modal key={item.id} label={item.message} alert narrow onClose={() => finish(item, false)}>
          <p>{item.message}</p>
          <div className="row mt8">
            {item.withCancel && <button type="button" className="btn ghost" onClick={() => finish(item, false)}>취소</button>}
            <button type="button" className="btn primary" onClick={() => finish(item, true)}>확인</button>
          </div>
        </Modal>
      ))}
    </DialogContext>
  );
}

export function useDialogs() {
  const value = useContext(DialogContext);
  if (!value) throw new Error("DialogProvider 안에서만 쓸 수 있습니다.");
  return value;
}
