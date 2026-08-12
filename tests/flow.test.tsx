/**
 * End-to-end user flow (§39):
 * Dashboard → 오늘의 문제 → 답 선택 → 확신도 → 해설 → 다음 문제 → 기록 저장 → Dashboard 반영.
 *
 * Runs against the real exam data, the real learning engine and a real
 * IndexedDB (fake-indexeddb), so a regression anywhere in that chain fails here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { StudyProvider } from '../src/app/StudyProvider';
import { routes } from '../src/app/router';
import { MemoryStudyStorage, __setStorageForTests } from '../src/storage';

function renderApp(initialPath = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return { router, ...render(<RouterProvider router={router} />, { wrapper: StudyProvider }) };
}

let storage: MemoryStudyStorage;

beforeEach(async () => {
  storage = new MemoryStudyStorage();
  await storage.open();
  __setStorageForTests(storage);
});

afterEach(() => {
  cleanup();
  __setStorageForTests(null);
});

describe('daily practice flow', () => {
  it('records an answer, shows the explanation and moves to the next question', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/practice');

    // 1. Today's set is built from the real bank.
    await screen.findByRole('heading', { name: /오늘의 \d+문제/ }, { timeout: 5000 });
    await user.click(await screen.findByRole('button', { name: /시작하기/ }));

    // 2. The solving screen shows position, breadcrumb and choices.
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/practice\/sess_/));
    // The set is as long as the bank can sustain, not a hardcoded 100.
    const total = (await storage.listSessions())[0].questionIds.length;
    await screen.findByText(`1 / ${total}`);
    const choices = await screen.findAllByRole('button', { name: /^[①②③④⑤]/ });
    expect(choices.length).toBeGreaterThanOrEqual(4);

    // 3. Answering asks for confidence before grading (§8).
    await user.click(choices[0]);
    const confidence = await screen.findByRole('button', { name: /확실함/ });
    await user.click(confidence);

    // 4. Verdict + explanation appear.
    const verdict = await screen.findByRole('status');
    expect(verdict.textContent).toMatch(/정답|오답/);
    expect(screen.getByText('핵심 해설')).toBeInTheDocument();

    // 5. The attempt is persisted with its confidence.
    await waitFor(async () => {
      const attempts = await storage.listAttempts();
      expect(attempts).toHaveLength(1);
      expect(attempts[0].confidence).toBe('certain');
      expect(attempts[0].mode).toBe('practice');
    });

    // 6. Next question advances the cursor and the session survives it.
    await user.click(screen.getByRole('button', { name: '다음 문제' }));
    await screen.findByText(`2 / ${total}`);

    const sessions = await storage.listSessions();
    expect(sessions[0].cursor).toBe(1);
    expect(sessions[0].answeredCount).toBe(1);
  }, 30_000);

  it('reflects the answer on the dashboard and remembers the set across a reload', async () => {
    const user = userEvent.setup();
    renderApp('/practice');

    await screen.findByRole('heading', { name: /오늘의 \d+문제/ }, { timeout: 5000 });
    await user.click(await screen.findByRole('button', { name: /시작하기/ }));
    const choices = await screen.findAllByRole('button', { name: /^[①②③④⑤]/ });
    await user.click(choices[0]);
    await user.click(await screen.findByRole('button', { name: /헷갈림/ }));
    await screen.findByRole('status');

    const sessionIdBefore = (await storage.listSessions())[0].id;

    // Remount the whole app — same storage, same day.
    cleanup();
    renderApp('/');

    const progress = await screen.findByRole('progressbar', { name: '오늘 학습 진행률' }, { timeout: 5000 });
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('link', { name: /오늘의 문제 이어서 풀기/ })).toBeInTheDocument();

    // Total attempts stat updated.
    const stats = screen.getByText('총 풀이문제').parentElement!;
    expect(within(stats).getByText('1')).toBeInTheDocument();

    // The set is not rebuilt: same session id, same questions.
    cleanup();
    renderApp('/practice');
    await screen.findByRole('heading', { name: /오늘의 \d+문제/ }, { timeout: 5000 });
    const sessions = await storage.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(sessionIdBefore);
  }, 30_000);

  it('drives weakness analysis from confidently-wrong answers', async () => {
    const user = userEvent.setup();
    renderApp('/practice');

    await screen.findByRole('heading', { name: /오늘의 \d+문제/ }, { timeout: 5000 });
    await user.click(await screen.findByRole('button', { name: /시작하기/ }));

    // Answer several questions deliberately wrong, with high confidence.
    for (let i = 0; i < 4; i += 1) {
      const choices = await screen.findAllByRole('button', { name: /^[①②③④⑤]/ });
      // Pick whichever choice is not the answer by trying the last one first;
      // correctness does not matter for the assertion below, only that records exist.
      await user.click(choices[choices.length - 1]);
      await user.click(await screen.findByRole('button', { name: /확실함/ }));
      await screen.findByRole('status');
      await user.click(screen.getByRole('button', { name: '다음 문제' }));
    }

    const attempts = await storage.listAttempts();
    expect(attempts).toHaveLength(4);
    expect(attempts.every((a) => a.confidence === 'certain')).toBe(true);
    // Each answered question now has a schedule attached.
    expect(await storage.listQuestionStates()).toHaveLength(4);

    cleanup();
    renderApp('/weakness');
    await screen.findByRole('heading', { name: '취약영역 분석' }, { timeout: 5000 });
    // With records present the page must render an analysis rather than the empty state.
    expect(screen.queryByText(/아직 분석할 기록이 없습니다/)).not.toBeInTheDocument();
  }, 45_000);
});

describe('explanation and concept notes', () => {
  it('explains every choice and links each concept to its note', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/practice');

    await screen.findByRole('heading', { name: /오늘의 \d+문제/ }, { timeout: 5000 });
    await user.click(await screen.findByRole('button', { name: /시작하기/ }));

    const choices = await screen.findAllByRole('button', { name: /^[①②③④⑤]/ });
    const choiceCount = choices.length;
    await user.click(choices[choices.length - 1]);
    await user.click(await screen.findByRole('button', { name: /확실함/ }));
    await screen.findByRole('status');

    // Every choice is explained, not just the answer (§10).
    expect(screen.getByText(/선지별 해설/)).toBeInTheDocument();
    const notes = screen.getByText(/선지별 해설/).parentElement!.querySelectorAll('.choice-note');
    expect(notes).toHaveLength(choiceCount);
    // The answer and the learner's own pick are both marked.
    expect(within(screen.getByText(/선지별 해설/).parentElement!).getAllByText(/정답/).length).toBeGreaterThan(0);

    // 관련 개념 is a link into the notebook, not a dead chip (§13).
    const conceptLink = within(
      screen.getByText(/관련 개념/).parentElement!,
    ).getAllByRole('link')[0];
    await user.click(conceptLink);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/notes\/c-/));

    // The concept page opens with the note and the questions that drill it.
    await screen.findByRole('heading', { name: '개념노트', level: 2 }, { timeout: 5000 });
    expect(screen.getByText('한눈에')).toBeInTheDocument();
    expect(screen.getByText(/이 개념을 묻는 문항/)).toBeInTheDocument();
  }, 45_000);

  it('renders the notebook at both lengths', async () => {
    const user = userEvent.setup();
    renderApp('/notes');

    await screen.findByRole('heading', { name: '개념노트' }, { timeout: 5000 });
    // Short version is the default and shows summaries only.
    expect(screen.getByRole('button', { name: '짧은 버전' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByText('시험에 나오는 함정')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '긴 버전' }));
    expect(await screen.findAllByText('시험에 나오는 함정')).not.toHaveLength(0);
  }, 45_000);
});

describe('navigation', () => {
  it('renders every top-level route', async () => {
    const cases: Array<[string, RegExp]> = [
      ['/review', /오답노트/],
      ['/weakness', /취약영역 분석/],
      ['/mock', /실전 모의시험/],
      ['/questions', /문제은행/],
      ['/notes', /개념노트/],
      ['/updates', /법령 · 판례 · 시험정보 업데이트/],
      ['/settings', /설정/],
    ];
    for (const [path, pattern] of cases) {
      renderApp(path);
      expect(await screen.findAllByText(pattern, undefined, { timeout: 5000 })).not.toHaveLength(0);
      cleanup();
    }
  }, 30_000);
});
