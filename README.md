# PlanCheck

Excel 재무표와 Word 재무설계 보고서의 수치 차이, 계산 오류, 자금 배정 및 계획의 모순을 확인하는 재무 문서 검수 도구입니다.

## 주요 기능

- **문서 등록:** XLSX·DOCX 파일에서 셀, 수식, 문단, 표와 원본 위치 추출
- **재무 정보 정리:** 금액 단위와 월간·연간 구분을 인식하고 재무 항목 연결
- **계산 검수:** 자산·부채 합계, 순자산, 잉여금, 대출 월 상환액 확인
- **문서 간 비교:** 같은 항목의 금액·금리 차이를 원본과 함께 표시
- **계획 검토:** 같은 자금의 중복 배정, 조건부 금액 반영, 제안·실행 충돌 후보 확인
- **결과 검토:** 필요한 질문에 답변하고 원문·계산 근거를 확인하거나 추출값 수정

자동으로 발견한 차이와 사용자 확인 후 판정을 구분합니다. 조건이나 근거가 부족한 항목은 오류로 확정하지 않습니다.

## 기술 스택

- **Frontend:** React, TypeScript, Vite
- **Styling:** Tailwind CSS, shadcn/ui 방식의 공통 컴포넌트, Pretendard
- **UI:** TanStack Table, Lucide React
- **Document Parsing:** JSZip, DOMParser 기반 OOXML 파싱
- **Testing:** Vitest, Testing Library, Playwright (Chrome)
- **Deployment:** Vercel

## 실행 방법

Node.js 22.12 이상이 필요합니다.

```bash
npm ci
npm run dev
```

프로덕션 빌드:

```bash
npm run build
npm run preview
```

기본 검사는 별도 API 키나 백엔드 설정 없이 실행할 수 있습니다.

## 사용 방법

1. Excel 재무표와 Word 보고서를 등록합니다.
2. 두 파일의 준비 상태를 확인한 뒤 **검사 시작**을 누릅니다.
3. 우선 확인할 문제에서 주요 값과 차이를 확인합니다.
4. 필요한 항목만 **이 항목 검토**에서 질문에 답하고 **답변 저장**을 누릅니다.
5. **판단 근거 보기**에서 원문과 셀·문단·표 위치, 계산 과정을 확인합니다.

단위·기간 등 추출값 수정과 고급 검증 설정은 상세 검토에서 사용할 수 있습니다. 파일을 교체하면 이전 검사와 관련 확인 상태가 초기화됩니다.

## 프로젝트 구조

- `src/parsers` — XLSX·DOCX 구조와 원본 데이터 추출
- `src/normalization` — 재무 항목 분류, 금액·단위·기간 정리, 연결 후보 생성
- `src/recommendations` — 검증에 필요한 항목과 관계 추천
- `src/validation` — 계산 및 문서 간 비교 규칙
- `src/planning` — 자금 배정과 계획 일관성 검증
- `src/inspection` — 검사 결과 구성과 검토 상태 관리
- `src/presentation` — 금액 표시, 결과 그룹화, 사용자 안내
- `src/components` — 문서 등록, 검사 결과, 상세 검토 화면
- `tests`, `e2e` — 단위·통합·브라우저 테스트
- `docs` — 상세 사용법과 검증·실험 기록

## 테스트

```bash
npm test
npm run lint
npm run format:check
npm run test:e2e
```

Chrome E2E는 `npm run build` 후 실행하며 로컬 Chrome이 필요합니다. 실제 문서를 사용하는 테스트는 환경변수로 파일 경로를 지정해야 합니다. 지정하지 않은 샘플 테스트는 건너뜁니다.

파일 경로 설정과 검증 규칙에 대한 자세한 내용은 [상세 사용 및 기술 안내](docs/user-guide.md)를 참고하세요.

## 데이터 처리 및 제한 사항

- 기본 검사는 브라우저 안에서 처리하며 문서를 외부 서버로 전송하지 않습니다.
- 원문과 편집 내용은 메모리에 유지됩니다. 선택형 임시 저장은 원문·금액 대신 제한된 확인 상태의 해시만 탭 세션에 저장합니다.
- Excel 수식은 재계산하지 않고 파일에 저장된 계산 결과를 읽습니다. 결과가 없거나 해석할 수 없으면 확인 필요로 표시합니다.
- 한국어 재무 문서의 명시적 항목과 제한된 문맥 규칙을 사용합니다. 모든 문서 형식이나 복합 계획을 자동으로 해석하지는 않습니다.
- 금융 상담이나 재무설계 생성, 문서 전체의 정확성을 보증하는 서비스는 아닙니다.
- 외부 AI API를 사용하지 않습니다.

## 관련 링크

- [PlanCheck](https://plancheck.cloud)
- [GitHub 저장소](https://github.com/sh2624/plancheck)
