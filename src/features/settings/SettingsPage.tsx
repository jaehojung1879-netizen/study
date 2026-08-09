/** /settings — study preferences, backup / restore / reset (§1, §31). */
import { useRef, useState } from 'react';
import { useStudy } from '../../app/StudyProvider';
import { Banner, SectionTitle, Stat } from '../../components/ui';
import { BackupFormatError, migrateBackup, SCHEMA_VERSION, type ImportReport } from '../../storage';

export function SettingsPage(): JSX.Element {
  const study = useStudy();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<{ tone: 'accent' | 'warn' | 'bad'; text: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);

  const exportBackup = async (): Promise<void> => {
    setBusy(true);
    try {
      const backup = await study.storage.exportAll();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `study-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: 'accent', text: '백업 파일을 내려받았습니다.' });
    } catch (error) {
      setMessage({ tone: 'bad', text: `백업 실패: ${describe(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (file: File): Promise<void> => {
    setBusy(true);
    setReport(null);
    try {
      const parsed = JSON.parse(await file.text());
      const migrated = migrateBackup(parsed);
      const result = await study.storage.importAll(migrated, importMode);
      await study.reload();
      setReport(result);
      setMessage({ tone: 'accent', text: '복원이 완료되었습니다.' });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text:
          error instanceof BackupFormatError
            ? error.message
            : `복원 실패: ${describe(error)}`,
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const resetAll = async (): Promise<void> => {
    const ok = window.confirm(
      '모든 학습기록(풀이기록·복습일정·모의시험·암기카드)을 삭제합니다. 되돌릴 수 없습니다. 먼저 백업을 내려받았습니까?',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await study.storage.clearAll();
      await study.reload();
      setMessage({ tone: 'warn', text: '모든 학습기록을 삭제했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <section>
        <h1>설정</h1>
      </section>

      {study.storageWarning ? <Banner tone="bad">{study.storageWarning}</Banner> : null}
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <section>
        <SectionTitle title="시험" />
        <div className="card">
          <label className="field">
            준비 중인 시험
            <select
              value={study.settings.activeExamId}
              onChange={(e) => void study.updateSettings({ activeExamId: e.target.value })}
            >
              {study.exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.name}
                </option>
              ))}
            </select>
          </label>
          <div className="divider" />
          <div className="grid grid--auto">
            <Stat label="시험일" value={study.index.config.examDate} />
            <Stat label="D-Day" value={`D-${Math.max(0, study.daysLeft)}`} />
            <Stat
              label="합격기준"
              value={`평균 ${study.index.config.passRule.overallAverageMinPercent}점`}
              hint={`과목별 ${study.index.config.passRule.perSubjectMinPercent}점 미만 과락`}
            />
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            시험일·문항수·합격기준은 <code>data/exams/{study.index.examId}/exam.json</code>에서 관리합니다.
            공식 공고가 나오면 이 파일만 고치면 앱 전체에 반영됩니다.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle title="학습" />
        <div className="card">
          <label className="field">
            하루 목표 문항수
            <input
              type="number"
              min={10}
              max={300}
              step={10}
              value={study.settings.dailyGoalOverride ?? study.index.config.daily.totalQuestions}
              onChange={(e) => {
                const value = Number(e.target.value);
                void study.updateSettings({
                  dailyGoalOverride:
                    Number.isFinite(value) && value !== study.index.config.daily.totalQuestions
                      ? Math.max(10, Math.min(300, value))
                      : null,
                });
              }}
            />
          </label>
          <p className="tiny muted" style={{ marginTop: 4 }}>
            기본값 {study.index.config.daily.totalQuestions}문항. 변경은 내일 세트부터 적용됩니다.
          </p>

          <div className="divider" />

          <div className="switch">
            <span>
              확신도 입력
              <br />
              <span className="tiny muted">끄면 모든 답이 &lsquo;헷갈림&rsquo;으로 기록되어 분석 정확도가 떨어집니다.</span>
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                void study.updateSettings({
                  confidencePromptEnabled: !study.settings.confidencePromptEnabled,
                })
              }
            >
              {study.settings.confidencePromptEnabled ? '사용 중' : '사용 안 함'}
            </button>
          </div>

          <div className="switch">
            <span>
              오답 원인 입력
              <br />
              <span className="tiny muted">틀린 뒤 원인을 한 번 눌러 기록합니다.</span>
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                void study.updateSettings({
                  errorCausePromptEnabled: !study.settings.errorCausePromptEnabled,
                })
              }
            >
              {study.settings.errorCausePromptEnabled ? '사용 중' : '사용 안 함'}
            </button>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle title="화면" />
        <div className="card">
          <label className="field">
            테마
            <select
              value={study.settings.theme}
              onChange={(e) =>
                void study.updateSettings({ theme: e.target.value as 'system' | 'light' | 'dark' })
              }
            >
              <option value="system">시스템 설정 따르기</option>
              <option value="light">라이트</option>
              <option value="dark">다크</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <SectionTitle title="데이터 백업 · 복원" aside={`schema v${SCHEMA_VERSION}`} />
        <div className="card stack">
          <Banner tone="warn">
            학습기록은 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우면 사라지므로 주기적으로 JSON
            백업을 내려받으세요.
          </Banner>

          <div className="grid grid--auto">
            <Stat label="풀이기록" value={study.attempts.length.toLocaleString('ko-KR')} />
            <Stat label="복습 대상 문항" value={study.states.length.toLocaleString('ko-KR')} />
            <Stat label="모의시험" value={`${study.mockResults.length}회`} />
            <Stat label="암기카드" value={`${study.flashcards.length}장`} />
          </div>

          <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={() => void exportBackup()}>
            JSON 백업 내려받기
          </button>

          <div className="divider" />

          <label className="field">
            복원 방식
            <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
              <option value="merge">병합 (기존 기록 유지, 없는 기록만 추가)</option>
              <option value="replace">덮어쓰기 (기존 기록 전부 삭제 후 복원)</option>
            </select>
          </label>

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importBackup(file);
            }}
            aria-label="백업 파일 선택"
          />

          {report ? (
            <div className="small">
              <div className="explain__label">복원 결과 ({report.mode === 'merge' ? '병합' : '덮어쓰기'})</div>
              <table className="data">
                <tbody>
                  {Object.entries(report.imported).map(([key, value]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td className="mono">추가 {value}</td>
                      <td className="mono">건너뜀 {report.skipped[key] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="divider" />

          <button type="button" className="btn btn--danger btn--block" disabled={busy} onClick={() => void resetAll()}>
            모든 학습기록 초기화
          </button>
        </div>
      </section>

      <p className="tiny faint">
        저장소: {study.storageKind === 'indexeddb' ? 'IndexedDB (Dexie)' : '메모리 (비영구)'} · 앱 버전{' '}
        {__APP_VERSION__}
      </p>
    </div>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
