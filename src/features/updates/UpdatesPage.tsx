/** /updates — statute / precedent / exam-notice change log (§15, §16). */
import { useMemo } from 'react';
import { useStudy } from '../../app/StudyProvider';
import { Banner, Empty, SectionTitle } from '../../components/ui';

const KIND_LABEL: Record<string, string> = {
  law: '법령',
  precedent: '판례',
  exam_notice: '시험정보',
};

const STATUS_LABEL: Record<string, string> = {
  detected: '변경 감지 · 검토 필요',
  reviewed: '검토 완료',
  applied: '문제 반영 완료',
};

export function UpdatesPage(): JSX.Element {
  const study = useStudy();
  const updates = [...study.index.updates].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

  const needsReview = useMemo(
    () => study.index.questions.filter((q) => q.needsReview),
    [study.index.questions],
  );

  const unverified = useMemo(
    () => study.index.questions.filter((q) => !q.verified).length,
    [study.index.questions],
  );

  return (
    <div className="stack-lg">
      <section>
        <h1>법령 · 판례 · 시험정보 업데이트</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          공식 출처 우선순위: ① 국가법령정보센터 ② 대법원 종합법률정보 ③ Q-Net 시험공고 ④ 기타 정부기관
          공식자료. 블로그·학원 자료는 법적 사실의 최종 근거로 사용하지 않습니다.
        </p>
      </section>

      {!study.index.config.scheduleVerified ? (
        <Banner tone="warn">
          현재 시험일({study.index.config.examDate})은 공식 공고로 확인되지 않은 잠정값입니다. D-Day와
          시험 직전 전략 전환이 이 날짜를 기준으로 동작하므로, 공고 확인 후 데이터를 갱신하세요.
        </Banner>
      ) : null}

      <section>
        <SectionTitle title="문제은행 검증 상태" />
        <div className="card">
          <div className="row row--between small">
            <span>전체 문항</span>
            <span className="mono">{study.index.questions.length}</span>
          </div>
          <div className="row row--between small">
            <span>미검증 (verified = false)</span>
            <span className="mono">{unverified}</span>
          </div>
          <div className="row row--between small">
            <span>검토 필요 표시 (needsReview)</span>
            <span className="mono">{needsReview.length}</span>
          </div>
          {needsReview.length > 0 ? (
            <>
              <div className="divider" />
              <div className="explain__label">검토 대상 문항</div>
              {needsReview.map((q) => (
                <div className="q-item" key={q.id}>
                  <div className="row" style={{ gap: 5 }}>
                    <span className="badge">{study.index.breadcrumb(q)}</span>
                    <span className="badge badge--bad">검토 필요</span>
                  </div>
                  <div className="q-item__stem">{q.question}</div>
                  {q.needsReviewReason ? (
                    <div className="tiny muted" style={{ marginTop: 4 }}>
                      {q.needsReviewReason}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
          <p className="tiny muted" style={{ marginTop: 10 }}>
            검토 필요로 표시된 문항은 오늘의 세트와 모의시험에서 자동으로 제외됩니다. 잘못된 법령이
            문제에 자동 반영되는 것보다 &ldquo;변경 감지 → 검토 필요 표시&rdquo;가 우선입니다.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle title="변경 이력" aside={`${updates.length}건`} />
        {updates.length === 0 ? (
          <Empty>기록된 변경 이벤트가 없습니다.</Empty>
        ) : (
          <div className="stack">
            {updates.map((update) => (
              <div className="card" key={update.id}>
                <div className="row" style={{ gap: 5 }}>
                  <span className="badge badge--accent">{KIND_LABEL[update.kind] ?? update.kind}</span>
                  <span className="badge">{update.detectedAt}</span>
                  <span
                    className={`badge ${update.status === 'applied' ? 'badge--ok' : update.status === 'detected' ? 'badge--warn' : ''}`}
                  >
                    {STATUS_LABEL[update.status] ?? update.status}
                  </span>
                </div>
                <h3 style={{ marginTop: 6 }}>{update.title}</h3>
                <p className="small" style={{ marginTop: 4 }}>
                  {update.summary}
                </p>
                {update.affectedLaws?.length ? (
                  <div className="chip-row" style={{ marginTop: 8 }}>
                    {update.affectedLaws.map((law, i) => (
                      <span className="chip chip--sm" key={i}>
                        {law.law} {law.article ?? ''}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="tiny faint" style={{ marginTop: 8 }}>
                  출처: {update.source}
                  {update.sourceUrl ? (
                    <>
                      {' · '}
                      <a href={update.sourceUrl} target="_blank" rel="noreferrer noopener">
                        {update.sourceUrl}
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="자동 변경 감지" />
        <div className="card">
          <p className="small">
            <code>scripts/check-law-updates.ts</code>가 저장된 법령 버전과 현재 공식 출처의 버전 정보를
            비교합니다. 변경이 감지되면 <code>data/exams/&lt;examId&gt;/updates/</code>에 이벤트를 기록하고
            관련 <code>lawReference</code>를 가진 문항을 <code>needsReview</code>로 표시합니다.
          </p>
          <p className="small muted" style={{ marginTop: 8 }}>
            현재 어댑터는 &ldquo;수동 확인&rdquo; 모드입니다. 자동 조회 어댑터를 붙이기 전까지는 사람이
            원문을 확인한 뒤 <code>data/exams/&lt;examId&gt;/law-sources.json</code>의 버전 값을 갱신하는
            방식으로 동작합니다.
          </p>
        </div>
      </section>
    </div>
  );
}
