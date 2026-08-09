import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useStudy } from './StudyProvider';

const NAV = [
  { to: '/', label: '홈', icon: '◎', end: true },
  { to: '/practice', label: '오늘의 문제', icon: '✎' },
  { to: '/review', label: '오답', icon: '↺' },
  { to: '/weakness', label: '취약영역', icon: '◔' },
  { to: '/mock', label: '모의시험', icon: '⏱' },
  { to: '/notes', label: '개념노트', icon: '▤' },
  { to: '/questions', label: '문제은행', icon: '⌕' },
];

export function AppShell(): JSX.Element {
  const study = useStudy();
  const location = useLocation();

  // Theme lives in settings so it survives a reinstall via backup/restore.
  useEffect(() => {
    const root = document.documentElement;
    if (study.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', study.settings.theme);
  }, [study.settings.theme]);

  // The solving screens are focus mode: minimal chrome, no bottom nav (§28).
  const focusMode =
    /^\/practice\/[^/]+$/.test(location.pathname) || /^\/mock\/[^/]+$/.test(location.pathname);

  return (
    <div className="app">
      {!focusMode ? (
        <>
          <header className="topbar">
            <div>
              <div className="topbar__title">{study.index.config.shortName}</div>
              <div className="topbar__sub">
                D-{Math.max(0, study.daysLeft)} · {study.analytics.phase.phase.label}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <NavLink to="/updates" className="btn btn--sm">
                업데이트
              </NavLink>
              <NavLink to="/settings" className="btn btn--sm">
                설정
              </NavLink>
            </div>
          </header>
          <nav className="nav" aria-label="주요 메뉴">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav__item">
                <span className="nav__icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </>
      ) : null}

      <main className={`app__main ${focusMode ? 'app__main--focus' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
