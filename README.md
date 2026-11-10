# PlanCheck

Excel 재무표와 Word 보고서의 원본 데이터를 브라우저에서 추출하는 작업 도구입니다. 현재 구현은 문서 추출과 열람에 한정됩니다.

## 실행

Node.js 22.12 이상을 사용합니다.

```sh
npm ci
npm run dev
npm test
npm run build
npm run lint
```

PowerShell 실행 정책으로 npm.ps1이 차단되면 `npm.cmd`를 사용합니다.

## 사용

1. Excel 재무표 영역에서 `.xlsx`를 선택합니다.
2. 시트를 선택하고 셀 주소, 원본 값, XML 저장값, 수식 및 저장된 계산 결과를 확인합니다.
3. Word 보고서 영역에서 `.docx`를 선택하고 문단과 표의 원문·행열 위치·숫자 문맥을 확인합니다.
4. 파일 교체 또는 초기화 시 해당 문서의 이전 결과는 삭제됩니다.

서버 업로드, 외부 API, 저장소 전송, 로컬 영구 저장은 구현하지 않았습니다. 새로고침하면 문서 데이터가 사라집니다. 파일 내용은 HTML로 실행하지 않고 텍스트로 표시합니다.

## 코드 구조

화면 글꼴은 Pretendard Variable로 통일합니다. `pretendard` 패키지의 WOFF2를 빌드에 포함하므로 외부 CDN이나 폰트 서버에 요청하지 않습니다. 흰색·회색 작업 영역과 남색 강조색, 간결한 제목과 표 중심 구성을 사용합니다.

- `src/parsers/package.ts`: 파일 검사 및 ZIP/XML 공통 처리
- `src/parsers/xlsx.ts`: 워크북 관계, 공유 문자열, 시트, 셀, 수식 캐시, 병합 영역 추출
- `src/parsers/docx.ts`: 본문 문단, 표, 셀 병합, 숫자 원문 추출
- `src/parsers/types.ts`: UI와 분리된 추출 데이터 형식
- `src/components/DocumentPanel.tsx`: 파일 선택, 오류, 초기화, 비동기 응답 순서 제어
- `src/components/WorkbookView.tsx`, `WordView.tsx`: 추출 결과 표시
- `src/components/ui`: shadcn/ui 구성 방식의 기본 UI 요소
- `tests`: 파서, 파일 변경, 실제 샘플 통합 테스트

React + TypeScript + Vite, Tailwind CSS, shadcn/ui 방식의 Radix Slot/CVA 버튼, TanStack Table 8, Lucide를 사용합니다. 상태는 각 문서 컴포넌트에 유지합니다.

문서 파서는 JSZip과 브라우저 DOMParser로 OOXML을 직접 읽습니다. 실제 제공 문서의 파싱 테스트를 바탕으로 선택했습니다. 수식 실행이나 서식 재현보다 원본 위치, 저장값, 문단·표 구조 보존에 우선순위를 둡니다.

## 실제 샘플 테스트

개인 문서를 저장소에 넣지 않고 환경변수로 지정합니다. 두 경로가 없으면 실제 샘플 테스트 2개는 건너뜁니다.

```powershell
$env:PLANCHECK_XLSX = 'C:\path\sample.xlsx'
$env:PLANCHECK_DOCX = 'C:\path\sample.docx'
npm.cmd test
```

## 범위와 한계

- 수식을 재계산하지 않습니다. 캐시 누락·오류는 `확인 필요`, 존재하는 캐시는 `미검증`으로 표시합니다. 공유 수식의 종속 셀은 참조 식별자를 보존하고 식을 재구성하지 않습니다.
- Excel 숫자는 XML 저장값입니다. 날짜 일련번호, 백분율, 통화·사용자 지정 서식은 표시 형식으로 변환하지 않습니다. 스타일만 있는 셀도 표시될 수 있습니다.
- Word는 `word/document.xml` 본문만 처리합니다. 머리글·바닥글, 주석, 텍스트 상자, 도형, 변경 추적과 필드 계산값을 완전히 해석하지 않습니다.
- Word 가로 병합은 열 수로, 세로 병합은 시작/계속 표기로 보존합니다. 중첩 표는 셀의 문단 텍스트로 평탄화합니다. 페이지 번호와 인쇄 레이아웃은 재현하지 않습니다.
- 숫자 토큰에는 날짜나 식별자도 포함될 수 있습니다. 금액·단위 정규화, 사용자 수정, 문서 간 연결, 검증 규칙, AI API는 미구현입니다.
- 파일 30MB, Excel 셀 100,000개, 읽은 XML 누적 100MB를 제한합니다. ZIP 엔트리의 압축 해제 후 용량을 검사하므로 악의적 압축 파일에 대한 완전한 메모리 보호 장치는 아닙니다. 대형 문서는 메인 스레드에서 처리되어 잠시 응답이 느려질 수 있습니다.

개인 샘플과 로컬 개발 지침·환경 파일은 `.gitignore`로 제외합니다.
