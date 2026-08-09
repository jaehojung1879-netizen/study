/**
 * /notes — 개념노트 (§13).
 *
 * The same notebook at two lengths. `짧은 버전` is the pre-exam pass: headline
 * plus a handful of lines per concept, readable end to end in one sitting.
 * `긴 버전` is the full note you open the first time a concept beats you. They
 * are written separately in the data, never derived from one another.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStudy } from '../../app/StudyProvider';
import { Empty, SectionTitle } from '../../components/ui';
import type { ConceptNote } from '../../exam/types';

type Depth = 'short' | 'long';

export function NotesPage(): JSX.Element {
  const study = useStudy();
  const [depth, setDepth] = useState<Depth>('short');
  const [subjectId, setSubjectId] = useState('all');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (conceptId: string, name: string): boolean => {
      if (terms.length === 0) return true;
      const note = study.index.conceptNote(conceptId);
      const haystack = [
        name,
        note?.headline ?? '',
        (note?.summary ?? []).join(' '),
        (note?.sections ?? []).map((s) => `${s.heading} ${s.body.join(' ')}`).join(' '),
        (note?.traps ?? []).join(' '),
        (note?.mnemonics ?? []).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    };

    // Grouped as 과목 › 대분류 › 소분류 so the notebook reads in syllabus order.
    const bySubject = new Map<
      string,
      { subjectName: string; majors: Map<string, { name: string; minors: Map<string, { name: string; concepts: Array<{ id: string; name: string }> }> }> }
    >();

    for (const entry of study.index.concepts()) {
      if (subjectId !== 'all' && entry.path.subjectId !== subjectId) continue;
      if (!matches(entry.conceptId, entry.name)) continue;
      const subject = bySubject.get(entry.path.subjectId) ?? {
        subjectName: study.index.subjectShortName(entry.path.subjectId),
        majors: new Map(),
      };
      const major = subject.majors.get(entry.path.majorTopicId) ?? {
        name: entry.path.majorTopicName,
        minors: new Map(),
      };
      const minor = major.minors.get(entry.path.minorTopicId) ?? {
        name: entry.path.minorTopicName,
        concepts: [],
      };
      minor.concepts.push({ id: entry.conceptId, name: entry.name });
      major.minors.set(entry.path.minorTopicId, minor);
      subject.majors.set(entry.path.majorTopicId, major);
      bySubject.set(entry.path.subjectId, subject);
    }
    return bySubject;
  }, [study.index, subjectId, query]);

  const shown = useMemo(() => {
    let count = 0;
    for (const subject of groups.values()) {
      for (const major of subject.majors.values()) {
        for (const minor of major.minors.values()) count += minor.concepts.length;
      }
    }
    return count;
  }, [groups]);

  const written = study.index.conceptNotes.length;
  const total = study.index.concepts().length;

  return (
    <div className="stack-lg">
      <section>
        <h1>개념노트</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          전체 {total}개 개념 중 {written}개에 노트가 있습니다. 짧은 버전은 시험 직전 회독용,
          긴 버전은 틀린 개념을 처음부터 다시 세울 때 읽는 용도입니다.
        </p>
      </section>

      <section className="stack">
        <div className="row">
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 'short'}
            onClick={() => setDepth('short')}
          >
            짧은 버전
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={depth === 'long'}
            onClick={() => setDepth('long')}
          >
            긴 버전
          </button>
        </div>

        <input
          type="search"
          value={query}
          placeholder="표현대리, 유치권, 탄력성, 환원이율 …"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="개념 검색"
        />

        <label className="field">
          과목
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="all">전체</option>
            {study.index.config.subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <SectionTitle title={`${shown}개 개념`} aside={depth === 'short' ? '요약' : '전문'} />

      {shown === 0 ? (
        <Empty>검색 조건에 맞는 개념이 없습니다.</Empty>
      ) : (
        [...groups.entries()].map(([sid, subject]) => (
          <section key={sid} className="stack">
            <h2 className="note-subject">{subject.subjectName}</h2>
            {[...subject.majors.entries()].map(([mid, major]) => (
              <div key={mid} className="stack">
                <h3 className="note-major">{major.name}</h3>
                {[...major.minors.entries()].map(([nid, minor]) => (
                  <div key={nid} className="note-minor">
                    <div className="note-minor__label">{minor.name}</div>
                    {minor.concepts.map((concept) => (
                      <NoteCard
                        key={concept.id}
                        conceptId={concept.id}
                        name={concept.name}
                        note={study.index.conceptNote(concept.id)}
                        depth={depth}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function NoteCard({
  conceptId,
  name,
  note,
  depth,
}: {
  conceptId: string;
  name: string;
  note?: ConceptNote;
  depth: Depth;
}): JSX.Element {
  return (
    <article className="card note-card">
      <div className="row row--between">
        <h4 className="note-card__title">{name}</h4>
        <Link to={`/notes/${conceptId}`} className="btn btn--sm">
          자세히
        </Link>
      </div>

      {!note ? (
        <p className="small muted" style={{ marginTop: 8 }}>
          아직 노트가 작성되지 않은 개념입니다. 문제 풀이로 먼저 접근하세요.
        </p>
      ) : (
        <>
          <p className="note-card__headline">{note.headline}</p>
          <ul className="note-list">
            {note.summary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>

          {depth === 'long' ? <NoteLongBody note={note} /> : null}
        </>
      )}
    </article>
  );
}

/** The long-form body, shared by the notebook and the single-concept page. */
export function NoteLongBody({ note }: { note: ConceptNote }): JSX.Element {
  return (
    <>
      {note.sections.map((section, i) => (
        <div className="explain__block" key={i}>
          <div className="explain__label">{section.heading}</div>
          {section.body.map((line, j) => (
            <p className="explain__body" key={j}>
              {line}
            </p>
          ))}
        </div>
      ))}

      {note.comparison ? (
        <div className="explain__block">
          <div className="explain__label">{note.comparison.title ?? '비교표'}</div>
          <div className="scroll-x">
            <table className="data note-table">
              <thead>
                <tr>
                  {note.comparison.columns.map((col, i) => (
                    <th key={i}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {note.comparison.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (j === 0 ? <th key={j}>{cell}</th> : <td key={j}>{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {note.traps?.length ? (
        <div className="explain__block">
          <div className="explain__label">시험에 나오는 함정</div>
          <ul className="note-list note-list--trap">
            {note.traps.map((trap, i) => (
              <li key={i}>{trap}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {note.mnemonics?.length ? (
        <div className="explain__block">
          <div className="explain__label">암기 문장</div>
          {note.mnemonics.map((line, i) => (
            <p className="explain__body explain__highlight" key={i}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {note.precedents?.length ? (
        <div className="explain__block">
          <div className="explain__label">판례</div>
          {note.precedents.map((p, i) => (
            <p className="explain__body" key={i}>
              {p.citation}
              {p.holding ? ` — ${p.holding}` : ''}
            </p>
          ))}
        </div>
      ) : null}

      {note.lawReferences?.length ? (
        <div className="explain__block">
          <div className="explain__label">법적 근거</div>
          <p className="explain__body">
            {note.lawReferences.map((l) => `${l.law} ${l.article ?? ''}`.trim()).join(' · ')}
          </p>
          {note.lawAsOf ? <p className="tiny faint">법령 확인일 {note.lawAsOf}</p> : null}
        </div>
      ) : null}
    </>
  );
}
