# 팀원 피드백 반영본 — 2026-11-12

## 전달할 버전과 현재 배포 상태

- 검증한 소스 커밋: `32ca7f1` / 로컬 태그 `team-feedback-ready-20261112`.
- 실제 검증용 Preview: https://plancheck-mbuut489t-sanghyun-lims-projects.vercel.app
- 이 Preview는 Vercel 프로젝트 접근 권한이 필요하다. 공개 팀원용 Production 주소는 https://plancheck.cloud 이며, **이번 수정의 Production 반영은 사용자가 직접 진행해야 한다**.
- GitHub push·Production 배포는 수행하지 않았다. 검증용 Preview만 배포했고 AI 화면·서버 분석은 모두 비활성화했다.

## 실제 팀원 파일 검증

docs 폴더의 실제 XLSX·DOCX를 사용했다. 동일 구조의 재현 파일만으로 성공을 주장하지 않는다. 원본은 읽기 전용으로 검사했으며 파일 바이트가 유지됨을 확인했다. 문서는 Git과 Vercel 소스 업로드에서 제외한다.

| 확인 항목                                          | 결과                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| Excel 금액(만원) 표·열 헤더의 단위 상속            | 통과, 개별 단위 입력 없음                              |
| 명시 셀 단위 우선·상충 단위 미확인                 | 기존 회귀 테스트 통과                                  |
| 월 소득·지출·저축·잉여금 추출                      | 실제 파일에서 추출, 수동 금액 입력 없음                |
| 잉여금 Excel 9만 원 vs Word 7만 원                 | 2만 원 차이 자동 발견                                  |
| 총자산 Excel 3,090만 원 vs Word 3,070만 원         | 20만 원 차이 자동 발견                                 |
| 추가 연결 승인                                     | 0회                                                    |
| 출처·계산 근거                                     | 파일명·위치·원문·근거를 실제 파서 결과와 동적으로 대조 |
| 청약저축/예금 잘못된 연결·현재/미래 자산 혼합 방지 | 실제 파일 및 기존 회귀 테스트 통과                     |
| AI 비활성 상태의 기본 검사                         | 로컬 Production 빌드와 실제 Preview Chrome에서 통과    |

두 차이는 사용자 확인 전에는 ‘확인 필요’로 표시한다. 발견 사실과 최종 확정 오류를 구분하며, 실제 파일을 올리고 검사 시작만 누른 상태의 확인된 오류는 0건이다.

## 이번 최소 변경

1. Production에서는 VITE_ENABLE_AI_CONTEXT가 잘못 true로 설정돼도 AI 화면 코드를 포함하지 않도록 빌드 단계에서 차단했다. 명시적인 Preview+true 조합만 실험 화면을 허용한다. 서버는 기존 VERCEL_ENV=preview 제한을 그대로 유지한다.
2. 계산 결과와 같은 원본을 공유하며 재계산값을 뒷받침하는 **기존** Excel·Word 비교를 함께 표시한다. 잉여금 9만 원/7만 원을 첫 결과에서 볼 수 있다. 원본 근거 펼치기에 두 문서 출처와 기존 계산·비교 근거를 보존했다. 비교 기준이 다르거나 연결에서 제외한 후보는 함께 표시하지 않는다.
3. 실제 배포 주소에도 같은 Chrome 테스트를 실행할 수 있게 했다. 문서가 서버로 전송되지 않도록 테스트 중 모든 POST를 차단했고, 실제 흐름에서 POST 시도는 없었다. 원격 테스트의 추적·스크린샷은 비활성화했으며 임시 인증 파일도 삭제했다.

파서·정규화·CALC·CROSS·ALLOC·PLAN 검증 엔진과 추천 규칙은 이번 단계에서 변경하지 않았다. AI 코드와 실험 결과도 삭제하지 않았다.

주요 변경 파일: src/config/features.ts, vite.config.ts, src/components/InspectionResults.tsx, playwright.config.ts, e2e/team-release.spec.ts, tests/features.test.ts, e2e/ai-context.spec.ts.

## 테스트 결과

- 전체 단위·통합 테스트: **236개 통과**, 실제 팀원 파일 테스트 포함.
- Production 환경+AI 플래그 true를 모사한 빌드: 통과. 클라이언트 번들에서 AI 패널·분석 요청 코드가 제외됨을 확인.
- 해당 빌드의 로컬 Chrome: **18개 통과**, AI 실험 전용 1개는 의도적으로 건너뜀.
- 보존된 AI 코드의 명시적 Preview 빌드·모의 API Chrome: **1개 통과**. 실제 AI 호출은 하지 않음.
- 배포된 AI 비활성 Preview의 Chrome: **1개 통과**. 실제 파일 등록 → 검사 시작 → 두 차이 확인 → 두 문서 원본 근거 확인. 단위·금액·연결 수정 없음.
- Preview API의 비식별 빈 요청: **503 AI_DISABLED**. 실제 금융 문서를 API에 보내지 않았다.
- 빌드·린트·포맷 통과. 기존 TanStack Table 관련 린트 경고 1건 유지.

이 검증은 실제 Preview와 로컬 Production 모드 빌드의 결과다. **새 코드가 Production에 반영됐다는 뜻은 아니다.**

## Production 설정과 사용자 배포

조회 당시 Production에는 OPENAI_API_KEY·OPENAI_MODEL만 있었고 VITE_ENABLE_AI_CONTEXT·PLANCHECK_AI_ENABLED 활성화 변수는 없었다. 기존 키는 서버에 보존했다. Production에 두 활성화 변수를 추가하지 않는다. 운영상 명시한다면 두 값을 false로 둔다. 플랫폼의 VERCEL_ENV는 직접 바꾸지 않는다.

실제 검증용 Preview는 배포별 VITE_ENABLE_AI_CONTEXT=false, PLANCHECK_AI_ENABLED=false로 생성했다. 프로젝트 전체 Preview 실험 설정이나 Production 환경변수는 변경하지 않았다.

사용자가 Git 연동 배포를 진행할 때:

```powershell
git status --short
git push origin main
```

Vercel에서 방금 올린 커밋의 Production 배포가 Ready인지 확인한다. 후속 보고서 커밋이 있더라도 앱 소스는 위 검증 소스와 동일하다. Git 자동 배포 대신 CLI가 필요한 경우 사용자 본인이 다음을 실행할 수 있다.

```powershell
npx.cmd vercel deploy --environment=production --build-env VITE_ENABLE_AI_CONTEXT=false --env PLANCHECK_AI_ENABLED=false
```

사용자가 실제 Production 배포를 완료한 뒤 수행할 최종 재검증:

```powershell
$env:PLANCHECK_E2E_BASE_URL='https://plancheck.cloud'
$env:PLANCHECK_TEAM_XLSX=(Resolve-Path 'docs/홍길동_재무표.xlsx').Path
$env:PLANCHECK_TEAM_DOCX=(Resolve-Path 'docs/홍길동_보고서.docx').Path
Remove-Item Env:PLANCHECK_E2E_STORAGE_STATE -ErrorAction SilentlyContinue
npm.cmd run test:e2e -- e2e/team-release.spec.ts
```

새 Production에서 두 차이·양쪽 출처·확인 필요 상태·AI UI 없음까지 확인한 뒤 팀원에게 공개 주소를 전달한다. 현재 Preview의 성공을 Production 성공으로 대신 보고하지 않는다.

## 한계와 복구

동일 예금 중복 배정, 조건부 세액공제·정부기여금 반영, ETF 중단/유지 충돌의 완전 자동 검출은 완성되지 않았다. 기존 수동 구조화·확인 기능을 유지하고, 금액·대상·기간·승인 여부가 부족하면 확인 필요 또는 검사 준비 상태로 표시한다. AI 품질 개선이나 신규 검증 규칙을 추가하지 않았다.

기존 stable-rules-20261112, baseline-before-hybrid-20261112, baseline-ai-diagnosis-20261112 태그를 유지했다. 이번 시작점은 baseline-before-team-release-20261112, 검증 소스는 team-feedback-ready-20261112로 보존했다. 기존 Production 배포는 그대로 유지했다.

## 팀원 전달 문구

“Excel·Word를 올리고 검사 시작을 누르면 단위나 연결을 따로 설정하지 않아도 잉여금 2만 원·총자산 20만 원 차이를 확인할 수 있습니다. 판단 근거 보기에서 각 문서 위치를 확인해 주세요. 차이는 우선 확인 필요로 표시되며, 복합 계획 검증은 추가 확인이 필요할 수 있습니다. 이번 전달본은 외부 AI 분석을 사용하지 않습니다.”
