# 선택형 AI 문맥 분석 Preview 실험

## 배포 전 설정

원격 push·배포는 사용자가 수행한다. `/api/analyze-context`는 Vercel Node Serverless Function이며 Vite는 상대 경로로 호출한다. 로컬 `vite dev`에는 API가 없고, 키 없이도 기본 검사는 모두 동작한다.

Vercel의 **Preview 환경에만** 다음 값을 설정하고 새 Preview를 배포한다.

- `OPENAI_API_KEY`: 기존 서버 키. `VITE_` 접두사를 붙이지 않는다.
- `PLANCHECK_AI_ENABLED=true`: 서버 실험 허용.
- `VITE_ENABLE_AI_CONTEXT=true`: 실험 UI 빌드 허용.

Production에서는 두 활성화 값을 제거한다. 서버는 `VERCEL_ENV=preview`가 아니면 키가 있어도 외부 호출을 거부한다. 개선 효과를 측정하기 전에는 프로덕션에 채택하지 않는다. 서버 API 파일이 생겨도 기존 정적 프론트엔드와 검사 엔진은 독립적으로 동작한다.

**Preview Deployment Protection을 활성화하고 실험 참가자에게만 접근을 허용한다.** Origin 검사는 인증이나 전체 사용량 제한이 아니다. 이 구현은 요청당 보수적 예상 상한 $0.06, 입력 16KB·8문장·문장당 1,200자, 출력 1,600토큰, 15초 API 타임아웃과 재시도 0회를 적용한다. 인스턴스 간 누적 비용 상한은 구현하지 않았다. OpenAI 프로젝트 예산·사용량을 별도로 제한/감시하고 실험 후 서버 플래그를 끈다. 타임아웃은 이미 발생한 비용을 환불하지 않는다.

## 배포 후 확인 순서

1. 키·플래그가 없는 환경에서 기본 XLSX·DOCX 검사가 정상인지 확인한다.
2. Preview에서 비식별 합성 문서를 업로드한다. 결과 아래 ‘선택형 AI 문맥 분석’을 펼친다.
3. 선택된 문장 전체와 외부 전송 안내를 읽는다. 파일명은 전송하지 않지만 문장 자체에 개인정보가 있을 수 있으므로 실제 금융자료는 사용하지 않는다.
4. 문장 선택과 동의 전에는 버튼이 비활성인지 확인한다. 동의 후 Network에서 상대 경로 API와 전송 범위를 확인한다. 키는 요청/응답/브라우저 번들에 없어야 한다.
5. AI 제안은 원문 인용과 함께 표시된다. 가져오기는 **미확인 계획 행**만 추가한다. 금액·대상 ID·기간·승인·수령 등은 기존 상세 검토에서 직접 확인한다. AI의 certainty가 confirmed여도 사용자의 확인으로 기록하지 않는다.
6. 파일 교체나 재무 정보 수정 시 동의·제안이 초기화되는지 확인한다. 키 제거·상류 오류 시 기본 결과가 유지되는지 확인한다.
7. 서버 애플리케이션은 원문·키·상류 응답을 로그에 쓰지 않는다. Vercel/OpenAI의 별도 로그·보존 설정도 배포 관리자가 확인한다. `store:false`는 서비스의 모든 보존 정책이 없다는 의미가 아니다.

## 합성 자료 성능 측정

PowerShell에서 `PLANCHECK_PREVIEW_URL`을 실제 Preview URL로 지정한 뒤 `node scripts/evaluate-ai-preview.mjs`를 실행한다. 필요한 경우 배포 보호 우회 비밀은 로컬 환경변수 `VERCEL_AUTOMATION_BYPASS_SECRET`에만 설정한다. 채팅이나 Git에 올리지 않는다. 이 스크립트는 합성 3유형과 정상 대조 1건을 순서대로 호출하며 성공/실패·후보 수·시간·추정 비용만 출력한다. 원문과 키는 출력하지 않는다.

자동 관계 제안 성공과 최종 오류 판정은 다르다. 이 스크립트는 **최종 판정을 평가하지 않는다**. 원본 근거 연결과 사람의 확인 후 엔진 판정은 브라우저에서 별도로 기록해야 한다. 기존 규칙 방식에 비해 놓친 관계·오탐·조작 수가 개선되지 않으면 실험 플래그를 끈 채 배포한다.

## 공식 규격과 모델

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses의 strict JSON schema, 거부·불완전 응답을 별도로 처리한다.
- [GPT-5.6 Terra 모델](https://developers.openai.com/api/docs/models/gpt-5.6-terra): 모델 ID 고정, 입력 $2/백만 토큰·출력 $12/백만 토큰으로 보수적 비용 계산. 가격/가용성은 실제 실험 전에 다시 확인한다.
- [Vercel Node 런타임](https://vercel.com/docs/functions/runtimes/node-js): 루트 `api`의 Web Request/Response 핸들러 사용. 추가 서버 유틸은 `server`에 두었다.

## 현재 검증 범위

실제 Preview 배포 주소가 아직 없어 네트워크 API 실험은 수행하지 않았다. 실제 호출 0회, 비용 $0, 지연시간·AI 검출률은 미측정이다. 모의 응답 테스트는 출처 검증·동의·실패 복구만 검증하며 AI의 문맥 이해 성능을 증명하지 않는다. 실제 문서 원본은 외부로 보내지 않았다.
