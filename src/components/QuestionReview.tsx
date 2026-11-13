import { useState } from 'react';
import type { ReviewChoice } from '../inspection/review';
import { Button } from './ui/button';
type Props = {
  question: string;
  choices: Record<ReviewChoice, string>;
  value?: ReviewChoice;
  onSave: (choice: ReviewChoice) => void;
  onAdvanced: () => void;
  onClose: () => void;
};
/** 선택과 저장을 구분하고 기존 확인 콜백만 호출한다. 원본·승인 정보는 생성하지 않는다. */
export function QuestionReview({ question, choices, value, onSave, onAdvanced, onClose }: Props) {
  const [choice, setChoice] = useState(value);
  return (
    <div className="question-review">
      <fieldset>
        <legend>{question}</legend>
        <div className="compound-choices">
          {(['same', 'different', 'unknown'] as const).map((answer) => (
            <label className="inline-choice" key={answer}>
              <input type="radio" name="review-answer" checked={choice === answer} onChange={() => setChoice(answer)} />
              {choices[answer]}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="compound-review-note">답변을 저장해도 최종 오류로 확정되지 않습니다.</p>
      <div className="finding-actions">
        <Button disabled={!choice} onClick={() => choice && onSave(choice)}>
          답변 저장
        </Button>
        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </div>
      <details className="review-advanced">
        <summary>상세 검토</summary>
        <p>원문 조건을 수정하거나 최종 판정에 필요한 정보를 확인합니다.</p>
        <Button variant="outline" onClick={onAdvanced}>
          상세 조건 확인·수정
        </Button>
      </details>
    </div>
  );
}
