import type { ReviewedFinding } from './findingGroups';
import type { ReviewChoice } from '../inspection/review';
/** 답변 저장의 완료와 기존 엔진의 최종 판정을 구분해 표시한다. 입력·승인 상태는 바꾸지 않는다. */
export function reviewCompletion(f: ReviewedFinding, choices?: Record<ReviewChoice, string>) {
  if (!f.decision) return;
  const answer =
    choices?.[f.decision.choice] ??
    {
      same: '예, 같은 기준입니다.',
      different: '아니요, 기준이 다릅니다.',
      unknown: '확인할 수 없습니다.',
    }[f.decision.choice];
  const verdict = f.approved?.status;
  const final =
    verdict === '오류'
      ? '확인된 오류'
      : verdict === '검증 통과'
        ? '검사 통과'
        : f.decision.choice === 'unknown'
          ? '판단 보류'
          : '오류 미확정';
  return {
    status: `일반 검토 완료 · ${final}`,
    answer: `저장한 답변: ${answer}`,
    conclusion:
      verdict === '오류'
        ? '기존 확인 조건에서 오류로 판정된 결과입니다.'
        : verdict === '검증 통과'
          ? '기존 확인 범위에서 통과한 결과입니다.'
          : f.decision.choice === 'unknown'
            ? '답변은 저장됐으며, 해당 조건과 최종 오류 판정은 보류합니다.'
            : '검토 답변을 저장했습니다. 최종 오류로 확정한 것은 아닙니다.',
    next:
      verdict === '오류'
        ? '필요하면 원문을 대조해 내용을 수정하세요.'
        : '추가 입력 없이 일반 검토를 마칠 수 있습니다. 최종 판정이 필요한 경우에만 상세 검토를 이용하세요.',
  };
}
