"use client";

import { createContext, useContext, useState, type FormEvent } from "react";
import { api, errText, usePending } from "./shared";

// 관리자 토큰은 메모리(App의 state)에만 보관한다. 탭/브라우저를 닫으면 다시 로그인해야 한다.
export type Admin = {
  token: string;
  adminApi: <T>(fn: string, ...args: unknown[]) => Promise<T>;
  login: (token: string) => void;
  logout: () => void;
};
export const AdminContext = createContext<Admin | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("AdminContext 안에서만 쓸 수 있습니다.");
  return value;
}

export function AdminLogin({ onDone }: { onDone?: () => void }) {
  const { login } = useAdmin();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, track] = usePending();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let response: { ok: boolean; message?: string; token?: string };
    try { response = await track(() => api<typeof response>("api_adminLogin", password)); }
    catch (e) { response = { ok: false, message: errText(e) }; }
    setPassword("");
    if (!response.ok || !response.token) { setMessage(response.message ?? ""); return; }
    login(response.token);
    onDone?.();
  };

  return (
    <section className="card stack mt5" style={{ gap: "1rem" }}>
      <h1 className="title" style={{ margin: 0 }}>관리자 로그인</h1>
      <p className="muted">출석 및 부원 관리는 도서부 담당자만 사용할 수 있습니다.</p>
      <form className="col" onSubmit={submit}>
        <label className="label">
          관리자 비밀번호
          <input type="password" className="field" autoComplete="current-password" aria-label="관리자 비밀번호"
            value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <p className="msg bad-text" role="alert">{message}</p>
        <button type="submit" className="btn primary lg" disabled={pending}>{pending ? "확인 중..." : "로그인"}</button>
      </form>
    </section>
  );
}

export function LogoutButton() {
  const { logout } = useAdmin();
  return <button type="button" className="btn ghost sm" onClick={logout}>로그아웃</button>;
}
