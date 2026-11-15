"use client";

import { useEffect } from "react";
import { mountApp } from "./ui";

// 머리글·꼬리말만 JSX이고, nav와 main의 내용은 ui.ts가 DOM으로 채운다.
export default function App() {
  useEffect(() => mountApp(), []);
  return (
    <>
      <header>
        <div className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img id="logo" src="/logo.png" alt="창원과학고등학교 도서관" width={1160} height={275} />
        </div>
        <nav id="nav" aria-label="주 메뉴"></nav>
      </header>
      <main id="main"></main>
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
    </>
  );
}
