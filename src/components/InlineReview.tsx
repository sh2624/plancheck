import { useState } from 'react';
import type { Finding } from '../inspection/analyze';
import type { Candidate } from '../normalization/types';
import { units } from '../normalization/types';
import { inlineRequirements, previouslyApprovedPair, type ReviewChoice, type InlineAnswers } from '../inspection/review';
import { Button } from './ui/button';
type Props = {
  finding: Finding;
  items: Candidate[];
  onApply: (choice: ReviewChoice, answers: InlineAnswers) => string[];
  onComplex: () => void;
  onClose: () => void;
};
/** 한 연결의 세 가지 답변과 실제 부족한 조건만 요청한다. 확인 없는 값은 채우지 않는다. */
export function InlineReview({ finding, items, onApply, onComplex, onClose }: Props) {
  const members = finding.recommendation?.candidateIds.map((id) => items.find((c) => c.id === id)).filter((c): c is Candidate => !!c) ?? [];
  const need = inlineRequirements(members);
  const reused = previouslyApprovedPair(finding, items);
  const [choice, setChoice] = useState<ReviewChoice | ''>(() => (reused ? 'same' : '')),
    [answers, setAnswers] = useState<InlineAnswers>({}),
    [issues, setIssues] = useState<string[]>([]);
  const patch = (next: Partial<InlineAnswers>) => {
    setAnswers((prev) => ({ ...prev, ...next }));
    setIssues([]);
  };
  const question = members[0]?.field.startsWith('loan')
    ? '두 값은 동일한 대출과 같은 기준일을 나타내나요?'
    : '두 값은 동일한 항목과 같은 기준일·시나리오를 나타내나요?';
  return (
    <div className="inline-review">
      {reused && <p className="review-reused">이 원본 연결은 이미 승인했습니다. 변경할 조건만 확인하세요.</p>}
      <fieldset>
        <legend>{question}</legend>
        {(
          [
            ['same', '예, 같은 기준입니다.'],
            ['different', '아니요, 다른 조건입니다.'],
            ['unknown', '확인할 수 없습니다.'],
          ] as const
        ).map(([value, label]) => (
          <label className="inline-choice" key={value}>
            <input
              type="radio"
              name={`basis-${finding.id}`}
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                setIssues([]);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {choice === 'same' && (
        <div className="inline-conditions">
          {(need.asOf || need.scenario || need.period || need.certainty) && (
            <p>
              현재 원문 조건:{' '}
              {members
                .map(
                  (c) =>
                    `${c.source} 기준일 ${c.asOf || '미확인'}, 시나리오 ${c.scenario || '미확인'}, 적용 기간 ${c.period || '미확인'}, ${c.certainty}`,
                )
                .join(' / ')}
              . 아래 답변은 두 항목에 적용되며 원문은 보존됩니다.
            </p>
          )}
          {need.asOf && (
            <label>
              공통 기준일
              <input value={answers.asOf ?? ''} placeholder="원문을 대조한 기준일" onChange={(e) => patch({ asOf: e.target.value })} />
            </label>
          )}
          {need.scenario && (
            <label>
              공통 시나리오
              <input
                value={answers.scenario ?? ''}
                placeholder="원문을 대조한 동일 계획"
                onChange={(e) => patch({ scenario: e.target.value })}
              />
            </label>
          )}
          {need.period && (
            <label>
              공통 적용 기간
              <input value={answers.period ?? ''} placeholder="예: 월간" onChange={(e) => patch({ period: e.target.value })} />
            </label>
          )}
          {need.certainty && (
            <label className="inline-certainty">
              <input
                type="checkbox"
                checked={!!answers.certaintyConfirmed}
                onChange={(e) => patch({ certaintyConfirmed: e.target.checked })}
              />
              두 수치가 확정된 값임을 원문에서 확인했습니다.
              <small>선택하지 않으면 원래 가정·조건부·미확인 상태를 유지하고 확정 오류 판정을 보류합니다.</small>
            </label>
          )}
          {members
            .filter((c) => need.units.includes(c.id))
            .map((c) => (
              <label key={c.id}>
                {c.source} 단위 확인
                <select
                  value={answers.units?.[c.id] ?? c.unit}
                  onChange={(e) =>
                    patch({
                      units: {
                        ...answers.units,
                        [c.id]: e.target.value as Candidate['unit'],
                      },
                    })
                  }
                >
                  {units.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
      {choice === 'different' && <p>이 연결의 승인을 해제하고 다른 조건으로 분류합니다. 원래 발견한 수치 차이는 기록에 남습니다.</p>}
      {choice === 'unknown' && <p>이 연결의 승인을 해제하고 미확인으로 보류합니다. 원본과 수치 차이는 계속 확인할 수 있습니다.</p>}
      {issues.length > 0 && (
        <ul className="inline-issues" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="finding-actions">
        <Button
          disabled={!choice}
          onClick={() => {
            if (choice) setIssues(onApply(choice, answers));
          }}
        >
          확인 내용 적용
        </Button>
        <Button variant="outline" onClick={onComplex}>
          고급 편집·개별 승인
        </Button>
        <Button variant="outline" onClick={onClose}>
          검토 닫기
        </Button>
      </div>
    </div>
  );
}
