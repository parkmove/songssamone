## 목적
이 저장소에서 AI 코딩 에이전트가 즉시 생산적으로 작업할 수 있도록 간결하고 실행 가능한 지침을 제공합니다.

## 개요
- Vite + React(TypeScript) 프론트엔드와 Cloudflare Worker 백엔드(수집용 엔드포인트 + 큐 소비자)로 구성됩니다.
- 프론트엔드: 정적 SPA, 라우트는 `src/App.tsx`에서 정의되어 있으며 페이지는 `src/pages/`에 있습니다 (예: `FormPage.tsx`, `DonePage.tsx`).
- 워커: `worker/src/index.ts`가 POST 요청을 받아 `LEAD_QUEUE`에 메시지를 전송하고, 큐 소비자가 배치로 Google Sheets에 기록합니다.

## 주요 파일 및 위치
- 프로젝트 문서: [README.md](README.md)
- 프론트엔드 진입점 및 라우팅: [src/main.tsx](src/main.tsx), [src/App.tsx](src/App.tsx)
- 페이지 컴포넌트: [src/pages](src/pages) (`FormPage.tsx`, `DonePage.tsx`)
- 빌드/개발 스크립트: [package.json](package.json) (루트) 및 [worker/package.json](worker/package.json)
- Vite 설정: [vite.config.ts](vite.config.ts)
- 워커 엔트리: [worker/src/index.ts](worker/src/index.ts)
- 워커 구성: [worker/wrangler.jsonc](worker/wrangler.jsonc)

## 아키텍처 및 데이터 흐름(중요)
- 브라우저 → POST → 워커의 `fetch` 핸들러: 페이로드를 즉시 `env.LEAD_QUEUE`로 전송합니다.
- `queue` 엔트리포인트(큐 소비자)는 `MessageBatch`를 받고 `toRow()`로 행을 만들고, `appendRows()`를 통해 Sheets API에 배치로 전송합니다.
- 핵심 디자인: 워커는 큐에 넣고 사용자에게 즉시 응답하여 클라이언트 지연을 최소화합니다. Sheets 쓰기는 비동기로 처리됩니다.

## 환경 변수 및 바인딩
- 워커가 기대하는 바인딩/환경변수(자세한 내용은 `worker/src/index.ts`의 `Env` 인터페이스 참조):
  - `LEAD_QUEUE` (Queue 바인딩)
  - `GOOGLE_SA_CLIENT_EMAIL`
  - `GOOGLE_SA_PRIVATE_KEY` (값 내의 `\n`을 실제 개행으로 변환해야 함)
  - `GOOGLE_SHEETS_SPREADSHEET_ID`
  - `GOOGLE_SHEETS_SHEET_NAME`

## 빌드 / 개발 / 테스트 명령
- 루트에서
  - 개발: `npm run dev` (vite)
  - 전체 빌드: `npm run build` (`tsc -b && vite build`) — `tsc -b` 통과 필요
  - 린트: `npm run lint`
- 워커 디렉터리에서
  - 개발: `cd worker && npm run dev` (wrangler dev)
  - 배포: `cd worker && npm run deploy` (wrangler deploy)
  - 테스트: `cd worker && npm run test` (vitest)

## 프로젝트 규약 및 패턴
- 라우팅은 `react-router-dom`을 사용하며 라우트 정의는 `src/App.tsx`에 중앙 집중.
- 페이지 컴포넌트는 단순한 함수형 컴포넌트 스타일을 따름(예: `DonePage.tsx`).
- 워커 코드에는 `fetch`와 `queue` 두 엔트리포인트가 동시에 존재함 — 둘 다 유지할 것.
- Google Sheets 인증은 WebCrypto로 JWT를 직접 생성/서명하는 방식으로 구현되어 있습니다. 인증 방식 변경 시 `getAccessToken`/`appendRows` 인터페이스를 유지하면 호환성이 좋습니다.

## 테스트
- 프론트엔드 단위 테스트는 포함되어 있지 않습니다.
- 워커 테스트는 `worker/`에서 `npm run test`로 실행합니다. 설정 파일: `worker/vitest.config.mts`.

## AI 에이전트를 위한 권장 행동
- 변경은 가능한 한 작게 유지하세요. 메시지 형식을 변경하면 `Env` 타입과 `worker/src/index.ts`의 페이로드 생성부를 함께 업데이트해야 합니다.
- API 바디(요청 스키마)를 변경하면 프론트엔드(`FormPage.tsx`)와 워커(`worker/src/index.ts`) 양쪽을 모두 수정하세요.
- 큐 기반 아키텍처는 지연 회피 목적이므로 임의로 제거하지 마세요.
- 지속 데이터 관련 기능은 가능하면 큐 소비자(배치 처리)에 추가하세요.

## 향후 확인 위치
- 배포 관련 변경은 `worker/wrangler.jsonc`와 `worker/package.json`을 확인하세요.
- 타입 또는 빌드 오류가 발생하면 `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`을 점검하세요.

불명확한 항목이나 더 확장하길 원하는 섹션(테스트, CI, 배포 세부사항 등)이 있으면 알려주세요.
