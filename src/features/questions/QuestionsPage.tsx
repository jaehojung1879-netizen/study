/** /questions — searchable question bank browser (§27). */
import { useMemo, useState } from 'react';
import { useStudy } from '../../app/StudyProvider';
import { ExplanationBody } from '../../components/Explanation';
import { CHOICE_MARK, Empty, QUESTION_TYPE_LABEL, SectionTitle, SourceBadge } from '../../components/ui';
import type { Question } from '../../exam/types';

const PAGE_SIZE = 20;

export function QuestionsPage(): JSX.Element {
  const study = useStudy();
  const [query, setQuery] = useState('');
  const [subjectId, setSubjectId] = useState('all');
  const [majorTopicId, setMajorTopicId] = useState('all');
  const [type, setType] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Full-text over stem, choices, explanation, tip and concept names, so
  // "표현대리" or "NPV" both land on the right items.
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of study.index.questions) {
      const conceptNames = q.conceptIds.map((c) => study.index.conceptName(c)).join(' ');
      map.set(
        q.id,
        [
          q.question,
          q.choices.join(' '),
          q.explanation,
          q.memoryTip ?? '',
          q.trap ?? '',
          conceptNames,
          study.index.breadcrumb(q),
          (q.lawReferences ?? []).map((l) => `${l.law} ${l.article ?? ''}`).join(' '),
        ]
          .join(' ')
          .toLowerCase(),
      );
    }
    return map;
  }, [study.index]);

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return study.index.questions.filter((q) => {
      if (subjectId !== 'all' && q.subjectId !== subjectId) return false;
      if (majorTopicId !== 'all' && q.majorTopicId !== majorTopicId) return false;
      if (type !== 'all' && q.questionType !== type) return false;
      if (terms.length === 0) return true;
      const haystack = searchIndex.get(q.id) ?? '';
      return terms.every((term) => haystack.includes(term));
    });
  }, [study.index.questions, searchIndex, query, subjectId, majorTopicId, type]);

  const majorTopics = subjectId === 'all' ? [] : study.index.majorTopics(subjectId);

  return (
    <div className="stack-lg">
      <section>
        <h1>문제은행</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          전체 {study.index.questions.length}문항. 개념·법조문·해설 전체를 검색합니다.
        </p>
      </section>

      <section className="stack">
        <input
          type="search"
          value={query}
          placeholder="표현대리, 수요 탄력성, 주택임대차, NPV …"
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE_SIZE);
          }}
          aria-label="문제 검색"
        />
        <div className="grid grid--2">
          <label className="field">
            과목
            <select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setMajorTopicId('all');
              }}
            >
              <option value="all">전체</option>
              {study.index.config.subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shortName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            출제형태
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">전체</option>
              {Object.entries(QUESTION_TYPE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {majorTopics.length > 0 ? (
          <label className="field">
            대분류
            <select value={majorTopicId} onChange={(e) => setMajorTopicId(e.target.value)}>
              <option value="all">전체</option>
              {majorTopics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <section>
        <SectionTitle title={`${results.length}문항`} />
        {results.length === 0 ? (
          <Empty>검색 결과가 없습니다.</Empty>
        ) : (
          <>
            {results.slice(0, limit).map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                expanded={expanded === q.id}
                onToggle={() => setExpanded((prev) => (prev === q.id ? null : q.id))}
              />
            ))}
            {results.length > limit ? (
              <button
                type="button"
                className="btn btn--block"
                style={{ marginTop: 12 }}
                onClick={() => setLimit((v) => v + PAGE_SIZE)}
              >
                더 보기 ({results.length - limit}문항 남음)
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function QuestionRow({
  question,
  expanded,
  onToggle,
}: {
  question: Question;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const study = useStudy();
  const state = study.stateOf(question.id);
  return (
    <div>
      <button type="button" className="q-item" onClick={onToggle} aria-expanded={expanded}>
        <div className="row" style={{ gap: 5 }}>
          <span className="badge">{study.index.breadcrumb(question)}</span>
          <SourceBadge question={question} />
          {state && state.totalAttempts > 0 ? (
            <span className="badge">
              {state.totalCorrect}/{state.totalAttempts} 정답
            </span>
          ) : null}
        </div>
        <div className="q-item__stem">{question.question}</div>
      </button>
      {expanded ? (
        <div className="card" style={{ marginTop: 6 }}>
          <div className="choices">
            {question.choices.map((choice, i) => (
              <div key={i} className={`choice ${i === question.answer ? 'choice--correct' : ''}`}>
                <span className="choice__num">{CHOICE_MARK(i)}</span>
                <span>{choice}</span>
                <span className="choice__mark">{i === question.answer ? '✓ 정답' : ''}</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <ExplanationBody question={question} index={study.index} />
        </div>
      ) : null}
    </div>
  );
}
