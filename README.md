# fcm-web

브라우저에서 Firebase Cloud Messaging(FCM)을 붙일 때 필요한 두 가지를 같이 제공합니다.

- 앱 코드에서 바로 쓰는 브라우저 런타임 헬퍼
- 다른 웹 프로젝트에 FCM 파일을 자동 생성하는 CLI

## 설치

```bash
npm install fcm-web
```

직접 런타임 API를 쓸 때는 `firebase`가 함께 설치됩니다.  
CLI를 일회성으로 실행해 다른 프로젝트에 코드를 생성할 때는 생성 대상 프로젝트에 `firebase`를 추가해야 하므로 `--install` 옵션을 같이 쓰는 편이 안전합니다.

## 기능 순서

1. Firebase 콘솔에서 웹 앱 설정값과 공개 VAPID 키를 준비합니다.
2. 대상 프로젝트 루트에서 `npx fcm-web init ... --install --json`으로 FCM 파일을 생성합니다.
3. 생성된 `src/lib/fcm.ts`를 앱 코드에서 import 해 FCM 클라이언트를 만듭니다.
4. 앱에서 알림 허용 시점에 `requestPermissionAndGetToken()` 또는 `getToken()`을 호출해 브라우저 토큰을 발급합니다.
5. 토큰이 발급되면 라이브러리가 `localStorage`에 토큰과 발급 상태를 자동 저장합니다.
6. 이후 `isNotificationConfigured()` 또는 `getStoredToken()`으로 브라우저에서 알림 설정 여부를 바로 확인합니다.
7. 발급된 토큰을 서버에 저장해 사용자와 디바이스를 연결합니다.
8. 앱이 열려 있을 때는 `onForegroundMessage()`로 포그라운드 메시지를 처리합니다.
9. 앱이 닫혀 있거나 백그라운드일 때는 `public/firebase-messaging-sw.js`가 백그라운드 알림을 처리합니다.

### 빠른 흐름 예시

```text
Firebase 설정 준비
-> CLI 실행
-> fcm.ts / firebase-messaging-sw.js 생성
-> 앱에서 createBrowserFCMClient() 호출
-> requestPermissionAndGetToken() 실행
-> localStorage 에 토큰/상태 저장
-> isNotificationConfigured() 로 상태 확인
-> 토큰 서버 저장
-> onForegroundMessage() 또는 서비스워커에서 메시지 수신
```

## CLI 사용

AI가 가장 짧게 쓰기 좋은 형태는 `init`을 생략하고 `--ai`를 같이 주는 방식입니다.

```bash
npx fcm-web \
  --ai \
  --config-json '{"apiKey":"AIza...","projectId":"your-project","messagingSenderId":"1234567890","appId":"1:1234567890:web:abcdef"}' \
  --vapid-key YOUR_PUBLIC_VAPID_KEY \
  --target . \
  --result-file .fcm-web/result.json
```

`--ai`를 주면 아래가 같이 적용됩니다.

- 결과를 JSON으로 출력
- `--install` 기본값이 `true`
- `firebase.web.json` 파일 없이도 `--config-json` 또는 환경변수로 설정 주입 가능
- 프로젝트 구조를 보고 `src/lib` 또는 `lib`, `fcm.ts` 또는 `fcm.js`, `public` 경로를 자동 추천

위 명령은 기본적으로 다음 파일들을 생성하거나 계획합니다.

- `src/lib/fcm.ts` 또는 `src/lib/fcm.js`
- `public/firebase-messaging-sw.js`
- `.fcm-web/result.json` 선택 생성

### AI용 입력 방식

파일 없이 환경변수만으로도 실행할 수 있습니다.

```bash
export FIREBASE_WEB_CONFIG_JSON='{"apiKey":"AIza...","projectId":"your-project","messagingSenderId":"1234567890","appId":"1:1234567890:web:abcdef"}'
export FCM_WEB_VAPID_KEY='YOUR_PUBLIC_VAPID_KEY'

npx fcm-web --ai --target . --result-file .fcm-web/result.json
```

### 사전 점검

프로젝트 구조만 먼저 보고 싶으면 `detect`를 사용합니다.

```bash
npx fcm-web detect --target . --json
```

실제로 파일을 쓰지 않고 계획만 보고 싶으면 `--dry-run`을 사용합니다.

```bash
npx fcm-web --ai --target . --dry-run
```

`--json`을 주면 AI 에이전트가 파싱하기 쉬운 JSON 결과를 출력합니다.

### `firebase.web.json` 예시

```json
{
  "apiKey": "AIza...",
  "authDomain": "your-project.firebaseapp.com",
  "projectId": "your-project",
  "storageBucket": "your-project.firebasestorage.app",
  "messagingSenderId": "1234567890",
  "appId": "1:1234567890:web:abcdef",
  "measurementId": "G-ABCDEFG"
}
```

### CLI 옵션

- `--config`: Firebase 웹 설정 JSON 파일 경로
- `--config-json`: Firebase 웹 설정 JSON 문자열
- `--config-env`: Firebase 웹 설정 JSON을 읽을 환경변수 이름
- `--api-key`, `--project-id`, `--messaging-sender-id`, `--app-id`: `--config` 없이 직접 넘길 때 사용
- `--auth-domain`, `--storage-bucket`, `--measurement-id`: 선택
- `--vapid-key`: 브라우저 푸시 토큰 발급용 공개 VAPID 키
- `--vapid-key-env`: VAPID 키를 읽을 환경변수 이름
- `--target`: 생성 대상 프로젝트 루트. 기본값은 현재 디렉터리
- `--src-dir`: 생성할 FCM 모듈 디렉터리. 미지정 시 자동 감지
- `--module-name`: 생성할 모듈 파일명. 미지정 시 `fcm.ts` 또는 `fcm.js` 자동 감지
- `--public-dir`: 서비스워커를 생성할 public 디렉터리. 미지정 시 자동 감지
- `--service-worker-name`: 서비스워커 파일명. 기본값 `firebase-messaging-sw.js`
- `--package-manager`: `npm`, `pnpm`, `yarn`, `bun`, `auto`
- `--ai`: AI 친화 모드. JSON 출력과 `--install` 기본 활성화
- `--dry-run`: 파일 쓰기와 설치 없이 계획만 출력
- `--result-file`: 결과 JSON을 파일로 저장
- `--install`: 대상 프로젝트에 `firebase` 설치
- `--force`: 기존 파일 덮어쓰기
- `--json`: 결과를 JSON으로 출력

## 런타임 API 사용

```ts
import { createBrowserFCMClient } from "fcm-web";

const fcm = createBrowserFCMClient({
  firebaseConfig: {
    apiKey: "AIza...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.firebasestorage.app",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
  },
  vapidKey: "YOUR_PUBLIC_VAPID_KEY"
});

const token = await fcm.requestPermissionAndGetToken();
const isConfigured = fcm.isNotificationConfigured();
const storedToken = fcm.getStoredToken();
const setupState = fcm.getNotificationSetup();

const unsubscribe = await fcm.onForegroundMessage((payload) => {
  console.log("foreground message", payload);
});
```

토큰이 발급되면 `localStorage`의 `fcm-web:<appName>:state` 키에 아래 형태로 저장됩니다.

```json
{
  "token": "FCM_TOKEN",
  "tokenIssued": true,
  "permission": "granted",
  "updatedAt": "2026-04-03T13:30:00.000Z"
}
```

### 버튼 상태 예시

아래처럼 쓰면 사용자가 한 번 알림 설정을 완료한 뒤 브라우저를 닫았다가 다시 들어와도 버튼 표기를 유지할 수 있습니다.

```ts
import { createBrowserFCMClient } from "fcm-web";

const fcm = createBrowserFCMClient({
  firebaseConfig,
  vapidKey: "YOUR_PUBLIC_VAPID_KEY",
  appName: "my-web-app"
});

const button = document.querySelector("#notification-button");

function renderNotificationButton() {
  const enabled = fcm.isNotificationConfigured();

  button.textContent = enabled ? "알림 설정 완료" : "알림 설정하기";
  button.disabled = enabled;
}

renderNotificationButton();

button.addEventListener("click", async () => {
  const token = await fcm.requestPermissionAndGetToken();

  if (!token) {
    renderNotificationButton();
    return;
  }

  await fetch("/api/push-tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ token })
  });

  renderNotificationButton();
});
```

페이지에 다시 들어왔을 때는 `renderNotificationButton()`만 호출해도 `localStorage`에 저장된 상태와 현재 브라우저 권한 상태를 기준으로 버튼 문구를 다시 맞출 수 있습니다.

## AI 에이전트용 권장 흐름

1. Firebase 콘솔에서 웹 앱 설정 JSON과 Web Push 인증서의 공개 VAPID 키를 준비합니다.
2. 대상 프로젝트 루트에서 `npx fcm-web --ai --target .` 또는 `npx fcm-web detect --json`을 실행합니다.
3. 생성된 `src/lib/fcm.ts` 또는 `src/lib/fcm.js`를 앱 진입 코드나 로그인 이후 토큰 등록 로직에서 import 합니다.
4. `public/firebase-messaging-sw.js`가 정적 루트에 배포되는지 확인합니다.

## 참고

- 생성된 서비스워커는 번들러 의존성을 피하기 위해 Firebase compat CDN 스크립트를 사용합니다.
- 앱 코드용 런타임 API는 최신 modular Firebase SDK를 사용합니다.
