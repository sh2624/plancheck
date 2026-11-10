import type { Result } from "./types";
/** 자동 분석은 관계·범위 승인을 대신하지 않으며 오류·통과 판정을 반환하지 않는다. */
export function provisional(result: Result): Result {
  return {
    ...result,
    status: result.status === "검증 불가" ? "검증 불가" : "확인 필요",
    basis: `자동 추천 관계를 가정한 참고 분석입니다. 사용자 승인이 아닙니다. ${result.basis.replace("사용자가 확인한 구조화 항목에 한정한 검증.", "자동 추출한 구조화 관계의 참고 분석.")}`,
    needs: [
      ...result.needs,
      "원본 항목의 의미·관계와 적용 기준을 검토하고 승인하세요.",
    ],
  };
}
