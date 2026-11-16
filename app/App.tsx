"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminContext, AdminLogin, type Admin } from "./components/admin";
import Attendance from "./components/Attendance";
import Calendar from "./components/Calendar";
import Home from "./components/Home";
import Members from "./components/Members";
import { DialogProvider } from "./components/modal";
import { api, isAuthError, todayKST } from "./components/shared";

const TABS = [["home", "출석체크"], ["calendar", "달력"], ["admin", "출석관리"], ["member", "부원관리"]] as const;
type Tab = (typeof TABS)[number][0];
const OPEN_TABS: Tab[] = ["home", "calendar"]; // 로그인 없이 볼 수 있는 탭
const ADMIN_IDLE_MS = 15 * 60 * 1000;

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [visit, setVisit] = useState(0); // 같은 탭을 다시 눌러도 새로 불러오도록 key로 쓴다
  const [token, setTokenState] = useState("");
  const tokenRef = useRef("");
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 탭을 옮겨 다녀도 유지되는 화면 상태
  const [homeShift, setHomeShift] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => todayKST().slice(0, 7));
  const [calendarSelected, setCalendarSelected] = useState("");
  const [adminDate, setAdminDate] = useState("");

  const go = useCallback((next: Tab) => { setTab(next); setVisit((v) => v + 1); }, []);
  const setToken = useCallback((value: string) => { tokenRef.current = value; setTokenState(value); }, []);

  const logout = useCallback(() => {
    const old = tokenRef.current;
    setToken("");
    clearTimeout(idle.current);
    go("home");
    api("api_adminLogout", old).catch(() => { /* 로컬 세션은 폐기됨 */ });
  }, [go, setToken]);

  const renewIdle = useCallback(() => {
    clearTimeout(idle.current);
    if (!tokenRef.current) return;
    idle.current = setTimeout(() => { if (tokenRef.current) logout(); }, ADMIN_IDLE_MS);
  }, [logout]);

  // 공용 PC에서 학생의 일반 출석 조작은 관리자 세션을 연장하지 않는다.
  useEffect(() => {
    const onActivity = () => { if (tokenRef.current && tab !== "home") renewIdle(); };
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
    return () => {
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
    };
  }, [tab, renewIdle]);
  useEffect(() => () => clearTimeout(idle.current), []);

  const admin = useMemo<Admin>(() => ({
    token,
    login: (value) => { setToken(value); renewIdle(); },
    logout,
    adminApi: async <T,>(fn: string, ...args: unknown[]) => {
      try { return await api<T>(fn, ...args, tokenRef.current); }
      catch (e) { if (isAuthError(e)) setToken(""); throw e; }
    },
  }), [token, logout, renewIdle, setToken]);

  const locked = !OPEN_TABS.includes(tab) && !token;
  const content = locked ? <AdminLogin key={"login" + visit} />
    : tab === "home" ? <Home key={visit} viewed={homeShift} setViewed={setHomeShift} />
    : tab === "calendar" ? (
      <Calendar key={visit} month={calendarMonth} setMonth={setCalendarMonth}
        selected={calendarSelected} setSelected={setCalendarSelected}
        onShowAttendance={(date) => { setAdminDate(date); go("admin"); }} />
    )
    : tab === "admin" ? <Attendance key={visit} date={adminDate} setDate={setAdminDate} />
    : <Members key={visit} onRulesChanged={() => go("calendar")} />;

  return (
    <AdminContext value={admin}>
      <DialogProvider>
        <header>
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img id="logo" src="/logo.png" alt="창원과학고등학교 도서관" width={1160} height={275} />
          </div>
          <nav id="nav" aria-label="주 메뉴">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" data-tab={key} aria-current={tab === key ? "page" : undefined} onClick={() => go(key)}>
                {label}
              </button>
            ))}
          </nav>
        </header>
        <main id="main">{content}</main>
        <footer className="site-credits" aria-label="개발 참여자">
          <span className="credits-label">개발</span>
          <span className="credit-person">
            15기 김우준{" "}
            <a href="https://github.com/WhoSia" target="_blank" rel="noopener noreferrer" aria-label="김우준 GitHub WhoSia">@WhoSia</a>
          </span>
          <span className="credits-divider" aria-hidden="true">·</span>
          <span className="credit-person">
            16기 안준표{" "}
            <a href="https://github.com/pugmy" target="_blank" rel="noopener noreferrer" aria-label="안준표 GitHub pugmy">@pugmy</a>
          </span>
        </footer>
      </DialogProvider>
    </AdminContext>
  );
}
