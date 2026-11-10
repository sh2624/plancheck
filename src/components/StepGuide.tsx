import { Button } from './ui/button';
export type Step = 'raw' | 'review' | 'results';
const guides = {
  raw: [
    '두 문서를 등록하세요',
    'Excel 재무표(.xlsx)와 Word 보고서(.docx)를 선택하세요. 문서 구성과 주요 재무 항목을 요약합니다.',
    '두 문서 등록 후 검사 시작을 누르면 숫자 차이와 확인 후보를 자동으로 찾습니다.',
    '파일은 브라우저에서만 처리합니다. 수식은 재계산하지 않으며 추출 후보는 아직 확정값이 아닙니다.',
  ],
  review: [
    '검증에 필요한 값만 확인하세요',
    '핵심 항목의 값·단위와 원본 문맥을 대조하세요. 기준일·시나리오는 상세 편집에서 확인할 수 있습니다.',
    '검수 결과에서 추천된 구성과 문서 간 연결을 검토·승인하세요. 전체 후보를 확인할 필요는 없습니다.',
    '항목 확인과 연결 승인은 별개입니다. 수정하면 관련 확인·승인이 해제됩니다.',
  ],
  results: [
    '차이와 원본 근거를 검토하세요',
    '자동 발견 후보와 사용자 확인 후 판정을 구분해 보세요. 선택한 항목의 원본 위치와 판단 근거만 펼칠 수 있습니다.',
    '준비 중인 검증은 필요한 항목이나 조건을 보완하고 추천을 승인하세요.',
    '준비 중은 실패나 정상 판정이 아닙니다. 서로 다른 기준일·시나리오는 확정 오류로 비교하지 않습니다.',
  ],
};
/** 단계별 안내를 인라인으로 표시하며 닫은 뒤에도 다시 열 수 있게 한다. */
export function StepGuide({ step, open, onToggle }: { step: Step; open: boolean; onToggle: () => void }) {
  const [title, purpose, next, caution] = guides[step];
  return (
    <aside className="step-guide" aria-label="단계 안내">
      <div className="guide-heading">
        <strong>{open ? title : '이 단계가 처음이신가요?'}</strong>
        <Button variant="outline" aria-expanded={open} aria-controls="step-guide-content" onClick={onToggle}>
          {open ? '안내 닫기' : '안내 다시 보기'}
        </Button>
      </div>
      {open && (
        <div id="step-guide-content">
          <p>{purpose}</p>
          <p>
            <strong>다음 단계</strong> {next}
          </p>
          <p className="muted">
            <strong>주의</strong> {caution}
          </p>
        </div>
      )}
    </aside>
  );
}
