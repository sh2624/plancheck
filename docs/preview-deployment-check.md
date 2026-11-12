# Preview 실제 배포 점검 — 2026-11-12

기능 신규 개발 없이 Vercel 호환 설정을 수정하고 Preview를 배포했다. 원격 main은 `d7e348b`로 유지하고 `preview/ai-validation`에 push했다. 실제 실행 소스 커밋은 `992648c`다. Production 배포·승격은 하지 않았다.

- Preview: https://plancheck-g0dvks07u-sanghyun-lims-projects.vercel.app
- Vercel 상태: READY, environment=preview, vercel_authentication 적용.
- Preview에 OPENAI_API_KEY 존재를 이름과 적용 범위만으로 확인했다. 값은 읽거나 출력하지 않았다.
- PLANCHECK_AI_ENABLED와 VITE_ENABLE_AI_CONTEXT는 Preview에만 추가했다.

## 실제 HTTP 검증

| 검사                              | 실제 결과                                          |
| --------------------------------- | -------------------------------------------------- |
| 인증된 함수 GET                   | 405 POST_REQUIRED — 함수 런타임 진입 확인          |
| 인증 없는 함수 GET                | 302 — Vercel 로그인으로 이동                       |
| 인증된 동의 없는 POST             | 400 ANALYSIS_FAILED — 외부 분석 실행 전 거부       |
| 합성 지원금 문장의 실제 외부 분석 | 실패: 502 AI_UNAVAILABLE, 상류 403 model_not_found |

실제 외부 분석 요청은 합성 지원금 문장으로 2회 시도했고 둘 다 실패했다. 성공 출력·토큰 사용량·비용은 반환되지 않아 실제 비용을 측정하지 못했다. 실제 팀원 문서는 전송하지 않았다. 이 결과는 모의 API 테스트가 아니라 배포된 함수의 실제 응답이다. AI 추출 성능과 ALLOC·PLAN 최종 판정 성공을 입증하지 않는다.

현재 모델 gpt-5.6-terra의 프로젝트 접근 권한 또는 사용 가능한 모델을 확인해야 한다. 사용자 확인 없이 모델을 교체하지 않았다. 서버 인증·누적 호출 제한은 별도로 구현하지 않았으며 보호된 Preview에서만 실험한다. 인증된 운영자의 테스트에는 Vercel CLI의 자동 보호 우회를 사용했고 일반 비인증 요청은 별도로 검증했다. CLI가 생성한 Automation Bypass 비밀은 프로젝트에 남으므로 실험 종료 시 Deployment Protection에서 폐기할 수 있다. 비밀 값은 저장소·보고서에 포함하지 않았다.

## 배포 문제와 수정

초기 재포함 방식 .vercelignore에서 하위 소스가 빠져 함수가 발견되지 않았다. 명시적 제외 목록으로 바꿔 docs·테스트·원본·환경변수·로컬 자료 제외를 유지했다. Vercel은 루트 tsconfig를 사용하므로 Node 타입과 모듈 설정을 추가하고 서버 import를 JS 출력 경로로 변경했다. 함수 실행은 수정 후 실제 GET으로 확인했다.

기존 전체 206개 회귀 테스트, 이후 추가 진단 테스트를 포함한 서버 안전성 24개, 빌드·린트·포맷을 통과했다. 기존 TanStack Table 경고 1건이 남아 있다. Preview에서의 전체 Chrome 사용자 시연과 실제 문서 AI 추출은 아직 검증하지 않았다. Production은 이전 안정 버전으로 유지한다.
