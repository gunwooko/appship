# AppShip TRD (Technical Requirements Document)

> **버전**: 0.1 (Draft)
> **작성일**: 2026-07-17
> **상태**: MVP 1 기술 설계
> **관련 문서**: [PRD.md](./PRD.md)

---

## 1. 아키텍처 개요

AppShip은 두 계층으로 나뉜다.

| 계층 | 역할 | 시점 |
|---|---|---|
| **AI 계층** | 프로젝트 분석, 메타데이터/문서 생성, 정책 검증, 체크리스트 | **MVP 1** |
| **배포 계층** | 빌드, 서명, AAB/IPA 업로드, 메타데이터 업로드, 심사 제출 | MVP 2+ (Fastlane, App Store Connect API, Google Play Developer API 연동) |

MVP 1은 AI 계층만 구현한다. 배포 계층은 직접 만들지 않고 기존 도구(Fastlane 등)와 연동한다는 전제로 설계한다.

### 파이프라인

```
detect ──▶ scan ──▶ generate ──▶ validate ──▶ report
(프로젝트   (권한/SDK/  (AI 호출로    (룰 엔진으로   (doctor
 유형 감지)  프라이버시   메타데이터/   글자수/정책/   readiness
            로컬 스캔)   문서 생성)    불일치 검증)   리포트)
```

- `init` = detect + scan + 대화형 질문 + 설정 생성
- `generate` = (scan 결과 로드) + generate + validate
- `doctor` = validate + report (AI 호출 없이도 동작 가능해야 함)

핵심 데이터 흐름 원칙: **모든 단계는 `.appship/analysis/`의 JSON 산출물을 통해 통신**한다. 각 명령어는 독립 실행 가능하며, 이전 단계 산출물이 없으면 필요한 단계를 자동 수행한다.

---

## 2. 구현 언어: Go vs TypeScript

> **결정 상태: TypeScript로 확정 (2026-07-17).** 근거는 §2.3. 아래 비교는 결정 기록으로 유지한다.

### 2.1 비교표

| 기준 | Go | TypeScript (Node) |
|---|---|---|
| **설치 경험** | 단일 바이너리. `brew install appship`, `curl \| sh`. Node 불필요 | `npx appship init` — RN 개발자는 Node가 이미 있으므로 **무설치 즉시 실행** |
| **타깃 사용자 적합성** | 별도 설치 단계 필요 | MVP 1 타깃(RN 개발자)의 기존 워크플로에 완전 일치 |
| **AI SDK 생태계** | 공식 SDK는 있으나 멀티 프로바이더 추상화 생태계 약함 → 직접 구현 | Vercel AI SDK 등 프로바이더 추상화(OpenAI/Anthropic/Gemini/Ollama)가 성숙 |
| **RN 프로젝트 파싱** | package.json/app.json은 JSON이라 무난하나, `app.config.js`·`babel.config.js` 등 **JS 실행이 필요한 설정은 파싱 불가** (별도 우회 필요) | JS 설정 파일을 그대로 로드 가능. RN 생태계 도구(metro 등)와 동일 언어 |
| **파일 스캔 성능** | 빠름, goroutine 병렬화 용이 | 충분히 빠름 (스캔 대상이 수천 파일 수준이라 병목 아님) |
| **크로스 플랫폼 배포** | goreleaser로 macOS/Linux/Windows 바이너리 자동화 | npm 배포는 간단. 단일 바이너리는 pkg/bun compile로 가능하나 차선 |
| **CLI 생태계** | cobra, viper, survey — 견고함 | commander/clipanion, prompts/inquirer, zod — 동등하게 성숙 |
| **장기 확장 (Flutter/Native)** | 언어 중립적이라 유리 | Flutter(pubspec.yaml)·Native(gradle/plist)도 파싱은 가능하나 JS 생태계 이점은 사라짐 |
| **기여자 저변** | Go 개발자 | **잠재 기여자 = 사용자(RN 개발자)와 동일 언어** → 오픈소스 기여 장벽 낮음 |

### 2.2 결정에 영향을 주는 사실

1. MVP 1은 **React Native 전용**이다. 사용자는 100% Node 환경을 갖고 있다.
2. RN 프로젝트의 핵심 설정(`app.config.js`, `react-native.config.js`)은 **JS 코드**라서, Go로는 정적 파싱이 불완전하다 (Node를 서브프로세스로 호출하는 우회가 필요 — 그러면 Go의 "무의존성" 장점이 희석된다).
3. AI 프로바이더 추상화는 이 제품의 핵심 모듈인데, TS 생태계가 압도적으로 앞서 있다.
4. Go의 강점(단일 바이너리, 빠른 스캔)은 MVP 3(멀티 플랫폼, CI/CD)에서 커지는 장점이다.

### 2.3 추천

**TypeScript를 추천한다.** 근거: (1) 타깃 사용자의 zero-install 실행(`npx`), (2) JS 설정 파일 파싱이 제품 정확도에 직결, (3) AI SDK 생태계, (4) 사용자=기여자 동일 언어. Go의 장점이 실제로 필요해지는 시점(MVP 3, 비-JS 플랫폼 지원)에는 스캐너 일부를 분리하는 선택지가 남아 있다.

단, **모듈 설계(§3)는 언어 중립으로 기술**하여 어느 쪽을 선택해도 유효하도록 한다.

---

## 3. 모듈 설계

언어 중립 구조. (TS 선택 시 `src/` 하위, Go 선택 시 `internal/` 하위로 동일하게 매핑된다.)

```
appship/
├── cli/                    # 명령어 정의 및 엔트리포인트
│   ├── init
│   ├── generate
│   └── doctor
├── core/
│   ├── project/            # 프로젝트 감지
│   │   ├── detector        # 프로젝트 유형 판별 (MVP 1: react-native)
│   │   └── react-native    # RN 전용: 앱 이름/번들ID/버전 추출
│   ├── scanner/            # 로컬 스캔 (외부 전송 없음)
│   │   ├── dependencies    # package.json, Podfile, build.gradle 의존성
│   │   ├── permissions     # Info.plist, entitlements, AndroidManifest.xml
│   │   ├── privacy         # SDK 시그니처 매칭 → privacy-report
│   │   └── source          # 소스코드 패턴 매칭 (API 호출 감지)
│   ├── ai/                 # AI 프로바이더 추상화
│   │   ├── provider        # 공통 인터페이스
│   │   ├── anthropic / openai / gemini / ollama / openai-compatible
│   │   └── payload         # 전송 페이로드 구성 (요약만, §5.1)
│   ├── metadata/           # 스토어별 생성 오케스트레이션
│   │   ├── apple           # App Store 산출물 정의
│   │   ├── google          # Google Play 산출물 정의
│   │   └── validator       # 글자 수/정책 룰 검증 (§7과 룰 공유)
│   ├── doctor/             # 룰 엔진 (§7)
│   ├── output/             # .appship/ 렌더링
│   │   └── templates/      # privacy-policy, terms, account-deletion,
│   │                       # support-page, review-notes 템플릿
│   └── config/             # appship.yml 로드/검증 (스키마 §4.3)
├── data/
│   ├── sdk-signatures      # SDK 시그니처 DB (§6)
│   └── rules               # doctor 룰 정의 (§7)
└── fixtures/               # 테스트용 샘플 RN 프로젝트 (§9)
```

### 모듈별 책임

| 모듈 | 입력 | 출력 | AI 호출 |
|---|---|---|---|
| `project` | 프로젝트 루트 경로 | `analysis/project.json` | ❌ |
| `scanner` | 프로젝트 파일 | `analysis/permissions.json`, `sdk-report.json`, `privacy-report.json` | ❌ |
| `ai` | 요약 페이로드 + 생성 요청 | 텍스트/구조화 응답 | ✅ |
| `metadata` | analysis + appship.yml + AI 응답 | `app-store/`, `google-play/` 산출물 | ✅ (validator는 ❌) |
| `doctor` | analysis + 생성물 + 룰 DB | `checklist/release-readiness.json` + 콘솔 리포트 | ❌ (기본) |
| `output` | 생성 결과 | `.appship/` 파일 트리 | ❌ |

**중요**: `scanner`와 `doctor`는 AI 없이 결정론적으로 동작한다. AI는 오직 "글쓰기"(메타데이터 문안, 법적 문서 초안)에만 사용된다. 이 분리가 원칙 1(사실 날조 금지)의 기술적 토대다 — **사실은 스캐너가 수집하고, AI는 그 사실을 문장으로 옮길 뿐이다.**

---

## 4. 데이터 모델

### 4.1 Finding 구조 (모든 분석 결과의 공통 단위)

```yaml
finding:
  type: microphone_access          # 감지 유형
  confidence: high | medium | low  # 감지 신뢰도
  evidence:                        # 근거 — 최소 1개 필수
    - ios/MyApp/Info.plist
    - android/app/src/main/AndroidManifest.xml
    - src/features/voice/useMicrophone.ts
  requires_confirmation: true      # 사용자 확인 필요 여부
  confirmed: null                  # 사용자 답변 (null = 미확인)
```

**불변 규칙**: evidence가 없는 finding은 생성될 수 없다 (스키마 레벨에서 강제).

### 4.2 analysis 산출물 스키마

**`analysis/project.json`**
```json
{
  "projectType": "react-native",
  "appName": "My App",
  "version": "1.0.0",
  "ios": { "bundleId": "com.example.myapp" },
  "android": { "packageName": "com.example.myapp" },
  "scannedAt": "2026-07-17T12:00:00Z",
  "appshipVersion": "0.1.0"
}
```

**`analysis/permissions.json`** — 플랫폼별 권한 finding 배열
```json
{
  "ios": [
    {
      "key": "NSMicrophoneUsageDescription",
      "present": true,
      "currentMessage": "This app requires microphone access.",
      "qualityAssessment": "needs_improvement",
      "evidence": ["ios/MyApp/Info.plist"]
    }
  ],
  "android": [
    { "key": "android.permission.RECORD_AUDIO", "present": true,
      "evidence": ["android/app/src/main/AndroidManifest.xml"] }
  ]
}
```

**`analysis/sdk-report.json`** — 감지된 SDK finding 배열
```json
{
  "sdks": [
    {
      "id": "firebase-analytics",
      "category": "analytics",
      "confidence": "high",
      "evidence": ["package.json: @react-native-firebase/analytics",
                    "src/lib/analytics.ts"]
    }
  ]
}
```

**`analysis/privacy-report.json`** — Data Safety 매핑 결과
```yaml
data_collection:
  location:
    collected: true
    purpose: [app_functionality]
    shared: false
    evidence:
      - src/services/location.ts:42
    requires_confirmation: true    # 정밀/근사 여부는 사용자 확인
    confirmed: null
  device_id:
    collected: true
    purpose: [analytics]
    shared: true
    evidence:
      - "@react-native-firebase/analytics"
    requires_confirmation: false
```

### 4.3 `appship.yml` 스키마 (프로젝트 루트)

```yaml
project:
  name: My App
  description: >
    A language learning app where users practice speaking
    in real-time voice rooms.
  audience:
    - language learners

platforms:
  ios:
    bundle_id: com.example.myapp
  android:
    package_name: com.example.myapp

stores:
  default_locale: en-US
  locales: [en-US, ko-KR]        # MVP 1: 생성만, 번역(localize)은 MVP 2

ai:
  provider: anthropic             # anthropic | openai | gemini | ollama | openai-compatible
  model: claude-sonnet-5          # 프로바이더별 기본값 존재
  tone: friendly
  # api_key는 파일에 넣지 않음 — 환경변수(ANTHROPIC_API_KEY 등)에서 읽음

privacy:
  send_source_code_to_ai: false   # 기본값. true여도 evidence 스니펫 수준만
  require_manual_confirmation: true
  scan_dependencies: true
  scan_source_code: true

# MVP 2+에서 추가: screenshots, release 섹션
```

- 로드는 "설정 파일 + 환경변수 + CLI 플래그" 우선순위로 병합
- 스키마 검증 실패 시 명확한 에러 (필드 경로 + 기대 타입)

---

## 5. AI 통합 설계

### 5.1 전송 페이로드 (프라이버시 원칙의 구현)

AI 프로바이더에 전송하는 것은 **요약 정보만**:

```json
{
  "projectType": "react-native",
  "appName": "My App",
  "userDescription": "A language learning app where ...",
  "audience": ["language learners"],
  "features": ["voice-chat", "login", "subscription"],
  "permissions": ["microphone", "notifications"],
  "sdks": ["firebase-analytics", "sentry", "revenuecat"],
  "locales": ["en-US", "ko-KR"]
}
```

- 소스코드, 파일 내용, 경로 목록은 전송하지 않는다 (`send_source_code_to_ai: false` 기본).
- `features`는 스캐너 감지 + init 질문 답변에서 도출한 추상 키워드다.
- 페이로드 구성은 `ai/payload` 모듈이 단일 책임으로 담당 → 전송 내용을 한곳에서 감사(audit) 가능. `--debug-payload` 플래그로 사용자가 전송 내용을 직접 확인할 수 있게 한다.

### 5.2 프로바이더 인터페이스

```
interface AIProvider {
  generate(request: GenerateRequest): Promise<GenerateResponse>
}

GenerateRequest {
  task: "app-store-description" | "keywords" | "privacy-policy" | ...
  payload: SummaryPayload        # §5.1
  constraints: { maxLength?: number, locale: string, tone: string }
}
```

- 지원: Anthropic, OpenAI, Gemini, Ollama, OpenAI-compatible endpoint
- TS 선택 시 Vercel AI SDK로 구현 단순화 가능 (인터페이스는 자체 정의 유지 — 락인 방지)

### 5.3 생성 전략: 프롬프트 + 후처리 검증

**AI 출력의 제약 준수를 신뢰하지 않는다.**

1. 프롬프트에 제약(글자 수, 톤, 금지 표현)을 명시하고
2. 응답을 **validator(§7과 동일 룰 테이블)로 검증**한 뒤
3. 위반 시 위반 내용을 첨부해 **최대 N회(기본 2회) 재생성** 요청
4. 재시도 후에도 실패하면 산출물에 `⚠ VALIDATION FAILED` 마커와 함께 저장하고 doctor에서 지적

### 5.4 단정 금지 출력 규칙

법적 문서·리뷰 노트 생성 프롬프트에 시스템 규칙으로 포함:

- 스캐너 finding에 없는 사실을 주장하지 않는다.
- 부정 단정("does not share user data") 대신 감지 기반 서술을 쓴다:
  > No explicit data-sharing SDK was detected. However, Firebase Analytics and Sentry were found. Please verify whether data is transferred to these providers.
- 확인되지 않은 항목은 `[CONFIRM: ...]` 플레이스홀더로 표시 → doctor가 잔여 플레이스홀더를 검출한다.

---

## 6. SDK/권한 시그니처 데이터베이스

`data/sdk-signatures`에 선언적 포맷(YAML)으로 관리. 코드 수정 없이 시그니처 추가 가능해야 한다.

### 6.1 시그니처 정의 포맷

```yaml
- id: firebase-analytics
  category: analytics
  detect:
    dependencies:                 # package.json / Podfile / build.gradle
      - "@react-native-firebase/analytics"
      - "firebase/analytics"
    source_patterns:              # 소스코드 정규식 (confidence 보강용)
      - "analytics\\(\\)\\.logEvent"
    config_keys: []               # Info.plist / manifest 키
  data_safety:                    # Data Safety 초안 매핑
    collects: [device_id, app_interactions]
    purpose_defaults: [analytics]
    shared_default: true
    requires_confirmation: false
```

- **confidence 산정**: dependencies 매치 = high, source_patterns만 매치 = medium, 간접 흔적(설정 키만) = low
- 매치된 모든 위치가 evidence로 기록됨

### 6.2 MVP 1 감지 대상 (초기 시그니처 목록)

| 카테고리 | SDK/API |
|---|---|
| Analytics | Firebase Analytics, Amplitude, Mixpanel |
| Crash | Firebase Crashlytics, Sentry |
| 인증 | Google Sign-In, Apple Sign-In, Facebook SDK |
| 결제 | RevenueCat, Stripe |
| 광고 | AdMob, AppsFlyer |
| 푸시 | OneSignal, Firebase Messaging |
| 디바이스 API | Location APIs, Contacts, Camera/Microphone, Advertising ID, Device identifiers |

### 6.3 권한 스캔 대상 파일

| 플랫폼 | 파일 |
|---|---|
| iOS | `ios/**/Info.plist`, `*.entitlements`, `ios/Podfile`, `PrivacyInfo.xcprivacy` |
| Android | `android/**/AndroidManifest.xml`, `android/**/build.gradle`, `gradle/libs.versions.toml` |
| 공통 | `package.json`, `app.json` / `app.config.js` |

---

## 7. doctor 룰 엔진

### 7.1 룰 카테고리

| 카테고리 | 예시 | 판정 |
|---|---|---|
| `required` | Support URL 존재, 앱 아이콘 존재, PrivacyInfo.xcprivacy 존재 | ✓ / ✗ |
| `length` | App Store 이름 ≤ 30자, Play 짧은 설명 ≤ 80자 | ✓ / ✗ |
| `policy` | 이모지/반복 특수문자(Play), 순위·가격 언급(Apple), 오해 소지 표현 | ✓ / ⚠ |
| `quality` | 권한 usage description의 구체성 (목적·상황 언급 여부) | ✓ / ⚠ + 개선안 |
| `consistency` | Analytics SDK 감지 ↔ privacy policy 언급 여부, 회원가입 감지 ↔ 계정 삭제 흐름/문서 존재 (Guideline 5.1.1), `[CONFIRM]` 플레이스홀더 잔존, `requires_confirmation` 미확인 finding | ✓ / ⚠ / ✗ |

### 7.2 룰 정의 포맷 (`data/rules`)

```yaml
- id: apple-name-length
  store: app-store
  category: length
  severity: error                 # error(✗) | warning(⚠)
  target: app-store/*/name.txt
  check: { type: max_length, value: 30 }
  message: "App name exceeds Apple's 30 character limit"

- id: account-deletion-required
  store: app-store
  category: consistency
  severity: error
  condition: { finding: login_detected }     # 이 finding이 있을 때만 검사
  check: { type: file_exists, value: legal/account-deletion.md }
  message: "User registration detected but no account deletion flow found"
  guideline: "Apple Guideline 5.1.1"
  fix_suggestions:
    - "Add account deletion under Settings > Account"
    - "Mention the deletion path in App Review Notes"
```

- 룰은 선언적 정의를 기본으로 하되, 복잡한 검사(권한 설명 품질 등)는 룰 id에 매핑된 내장 체커 함수로 구현
- 스토어 정책 변경 시 **룰 파일만 업데이트**하면 되는 구조 (MVP 3의 정책 업데이트 체계 대비)

### 7.3 readiness score

```
score = 100 × (통과 가중치 합) / (전체 가중치 합)
  - error 룰 가중치 3, warning 룰 가중치 1
  - 스토어별로 별도 산출 (App Store readiness / Google Play readiness)
```

결과는 콘솔 리포트 + `checklist/release-readiness.json`(기계 판독용)으로 이중 출력.

---

## 8. CLI / UX 설계

### 8.1 공통

- 종료 코드: 성공 0, `doctor`에서 error 존재 시 1 (CI 게이트로 사용 가능), warning만 있으면 0
- `--json` 플래그: 사람용 출력 대신 JSON 출력 (모든 명령어)
- `--non-interactive` (또는 CI 환경 자동 감지): 대화형 질문 생략, 미확인 항목은 `requires_confirmation` 상태로 남기고 doctor가 지적
- 색상/이모지 출력, `NO_COLOR` 존중

### 8.2 `appship init`

```
appship init [--force] [--non-interactive]
```

흐름: 감지 결과 출력 → 대화형 질문 6개 → `appship.yml` + `.appship/analysis/` 생성.
`appship.yml`이 이미 있으면 기존 값을 기본값으로 재질문 (`--force`는 무시하고 재생성).

### 8.3 `appship generate`

```
appship generate [ios|android|metadata] [--locale en-US] [--dry-run]
```

- 인자 없으면 전체 생성. `--dry-run`은 파일 쓰기 없이 생성 결과 미리보기
- 실행 전 `requires_confirmation` 미확인 finding이 있으면 먼저 확인 질문 (non-interactive면 스킵 후 경고)
- 기존 파일 덮어쓰기 전 diff 요약 표시 + 확인 (사용자가 수동 편집한 산출물 보호)

### 8.4 `appship doctor`

```
appship doctor [--store app-store|google-play] [--json]
```

- AI 호출 없이 로컬에서만 동작 (오프라인 실행 가능)
- 출력: 스토어별 readiness %, ✓/✗/⚠ 목록, 각 항목에 근거와 수정 제안

---

## 9. 테스트 전략

| 대상 | 방법 |
|---|---|
| `project` / `scanner` | `fixtures/`에 샘플 RN 프로젝트 2~3개(권한/SDK 조합이 다른) 커밋 → 스캔 결과 스냅샷 테스트. **감지 정확도가 제품 신뢰의 핵심이므로 최우선 커버** |
| `metadata/validator`, `doctor` 룰 | 순수 함수 단위 테스트 (룰별 통과/실패 케이스) |
| `ai` | 프로바이더 목킹. 페이로드 구성 테스트로 **소스코드 미포함을 회귀 테스트로 보장** (프라이버시 원칙의 테스트화) |
| `output` | 생성 파일 트리 스냅샷 |
| E2E | fixture 프로젝트에서 `init --non-interactive → generate --dry-run (AI mock) → doctor` 전체 파이프라인 |

---

## 10. 배포 / 설치

언어 결정(§2)에 따라:

| | TypeScript 선택 시 | Go 선택 시 |
|---|---|---|
| 주 채널 | npm (`npx appship`, `npm i -g appship`) | GitHub Releases + goreleaser |
| 보조 채널 | Homebrew (node 래핑) | Homebrew, `curl \| sh` |
| 버전 정책 | SemVer. 0.x 동안은 minor에 breaking 허용 | 동일 |

- 릴리스는 GitHub Actions로 자동화 (태그 → 빌드 → 배포)
- `appship.yml`에 `appshipVersion` 기록 → 버전 간 마이그레이션 감지

---

## 11. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| **스토어 정책 변경** (글자 수, 필수 항목, Data Safety 항목 개정) | 룰/시그니처를 코드와 분리된 데이터 파일로 관리(§6, §7) → 데이터 업데이트만으로 대응. 릴리스 노트에 "정책 기준일" 명시 |
| **AI hallucination** (없는 기능 서술, 근거 없는 단정) | 사실 수집(스캐너)과 문장 생성(AI) 분리(§3), 단정 금지 프롬프트 규칙 + `[CONFIRM]` 플레이스홀더 + doctor 검출(§5.4) |
| **감지 누락 (false negative)** — 수집하는데 신고 안 함 → 스토어 제재 리스크 | 시그니처 DB 커뮤니티 기여 유도, "AppShip 결과는 초안이며 최종 확인은 개발자 책임" 고지, doctor에서 미확인 항목 강조 |
| **AI 비용/속도** | 생성물 단위 캐싱 (입력 payload 해시 기준), `--dry-run`, Ollama 등 로컬 모델 지원 |
| **API 키 취급** | 설정 파일에 키 저장 금지, 환경변수만. `.appship/`에 키/토큰 기록 금지 |
| **법적 문서의 법적 효력** | 생성 문서 상단에 "초안이며 법률 자문이 아님" 고지 삽입 |

---

## 12. 미결정 사항 (Open Questions)

| 항목 | 상태 |
|---|---|
| 구현 언어 (Go vs TS) | ~~보류~~ → **TypeScript 확정** (2026-07-17, §2.3 근거) |
| 프로젝트/패키지 이름 확정 (appship vs 기타) | npm/브랜드 가용성 확인 후 결정 |
| AI 기본 프로바이더/모델 | Anthropic + claude-sonnet-5를 기본값으로 제안, 추상화로 교체 가능 |
| `.appship/`을 git에 커밋할지 권장 여부 | 커밋 권장(리뷰 가능한 제출 자료) 방향으로 제안, README에서 안내 예정 |
