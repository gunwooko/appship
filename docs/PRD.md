# AppShip PRD (Product Requirements Document)

> **버전**: 0.1 (Draft)
> **작성일**: 2026-07-17
> **상태**: MVP 1 기획
> **관련 문서**: [TRD.md](./TRD.md)

---

## 1. 개요 & 비전

**AppShip is an open-source AI release assistant that analyzes your mobile app and prepares everything required for App Store and Google Play submission.**

AppShip은 모바일 앱 프로젝트 루트에서 실행하면 프로젝트를 자동 분석하여, App Store와 Google Play 제출에 필요한 메타데이터·개인정보 문서·법적 문서·체크리스트를 생성하고, 제출 전 심사 거절 리스크를 검사해주는 CLI 도구다.

한 문장 포지셔닝:

> **Fastlane이 앱을 업로드한다면, AppShip은 앱이 무엇인지 이해하고 제출 준비를 대신한다.**

- **형태**: 오픈소스 CLI (프로젝트 루트에서 실행)
- **1차 지원 대상**: React Native 프로젝트 (MVP 1)
- **산출물**: 프로젝트 내 `.appship/` 폴더에 제출용 자료 일체 생성

---

## 2. 문제 정의

앱을 개발하는 것과 앱을 **스토어에 제출하는 것**은 완전히 다른 종류의 일이다. 개발자는 제출 단계에서 다음과 같은 반복적이고 오류가 잦은 작업에 수 시간~수 일을 소비한다.

| 고통 | 설명 |
|---|---|
| **메타데이터 작성** | 앱 이름(30자 제한), 부제목, 설명, 키워드, 프로모션 문구를 스토어별 규격·정책에 맞게 작성해야 함 |
| **개인정보 설문** | Apple Privacy Nutrition Labels, Google Play Data Safety 항목을 앱이 실제로 수집하는 데이터와 일치하게 신고해야 함. 코드에 어떤 SDK가 뭘 수집하는지 파악하는 것 자체가 어려움 |
| **권한 설명** | `NSMicrophoneUsageDescription` 등 권한 사용 목적을 구체적으로 작성하지 않으면 심사 거절 사유가 됨 |
| **법적 문서** | Privacy Policy, Terms of Service, 계정 삭제 안내, 서포트 페이지가 필수인데 매번 처음부터 작성 |
| **심사 거절 대응** | Guideline 5.1.1(계정 삭제) 같은 흔한 거절 사유를 제출 전에 알기 어려움 |
| **다국어 지원** | 출시 국가별로 메타데이터를 번역·관리해야 함 |

**기존 도구의 한계**: Fastlane은 빌드·서명·업로드를 자동화하지만, "무엇을 제출할지"(메타데이터 내용, 개인정보 신고 내용, 정책 준수 여부)는 전적으로 개발자 몫이다. 이 빈 자리가 AppShip이 해결하는 문제다.

---

## 3. 타깃 사용자

### MVP 1 타깃

- **1인 개발자 / 소규모 팀의 React Native 개발자**
- 앱 개발은 끝냈지만 스토어 제출 절차가 처음이거나 번거로운 사람
- App Store Connect / Play Console에서 시간을 쓰고 싶지 않은 사람

### 이후 확장

- Flutter, Native iOS/Android 개발자 (MVP 3)
- CI/CD로 릴리스를 자동화하려는 팀 (MVP 3)

---

## 4. 핵심 설계 원칙 (제품 관점)

이 세 가지 원칙은 모든 기능 설계에 우선한다.

### 원칙 1 — AI는 사실을 만들어내지 않는다

- AI가 "This app does not share user data" 같은 단정을 생성하는 것을 금지한다.
- 모든 분석 결과(finding)에는 **근거(evidence)** — 파일 경로, 의존성 이름 — 를 반드시 첨부한다.
- 코드 분석으로 확정할 수 없는 항목(예: 위치 정보가 정밀/근사인지)은 **확정하지 않고 사용자에게 확인을 요청**한다. 특히 Google Play Data Safety는 개발자 자기 신고 기반이므로, AppShip은 "제안 + 근거 + 사용자 확인" 흐름을 강제한다.

```
⚠ Location collection detected

We found location access in:
- src/services/location.ts
- AndroidManifest.xml

Please confirm:
● Precise location
○ Approximate location
○ Location is only processed locally
```

### 원칙 2 — 소스코드를 외부로 보내지 않는다 (프라이버시 우선)

- 프로젝트 스캔은 **기본적으로 로컬**에서 수행한다.
- AI 프로바이더에는 소스코드가 아니라 **요약된 분석 결과만** 전송한다 (프로젝트 유형, 기능 목록, 권한, SDK 목록 수준).
- 기본 설정: `privacy.send_source_code_to_ai: false`

### 원칙 3 — 외부 공개 동작은 명시적 확인형

- 생성(generate)·검증(doctor)은 자동화해도 되지만, 스토어 제출처럼 **되돌리기 어렵고 외부에 공개되는 동작**은 반드시 명시적 확인(`Proceed? [y/N]`)을 거친다. (MVP 1에는 제출 기능이 없지만, 이후 모든 버전에 적용되는 원칙)

---

## 5. MVP 1 기능 요구사항

MVP 1은 **React Native 전용**, 명령어는 **3개**(`init`, `generate`, `doctor`), **스토어 업로드 없음**.

### 5.1 `appship init` — 프로젝트 분석 & 초기화

**자동 감지** (프로젝트 파일 로컬 스캔):

```
✓ React Native project detected
✓ iOS bundle ID: com.example.myapp
✓ Android package: com.example.myapp
✓ App name: My App
✓ Version: 1.0.0
✓ Permissions detected: Camera, Microphone
✓ Firebase Analytics detected
✓ In-app purchases detected
```

- 프로젝트 유형 (React Native 여부)
- 앱 이름, iOS bundle ID, Android package name, 버전
- iOS/Android 권한 (Info.plist, AndroidManifest.xml)
- 주요 SDK (analytics, crash reporting, 결제, 광고, 인증 등 — 목록은 TRD §6 참고)

**대화형 질문** (코드로 알 수 없는 정보):

- What does your app do?
- Who is the target audience?
- Does the app require login?
- Does the app collect personal data?
- Which countries will you release in?
- Which languages should be generated?

**산출물**:

- 프로젝트 루트에 `appship.yml` 설정 파일 생성
- `.appship/` 폴더 및 `analysis/` 리포트 생성

### 5.2 `appship generate` — 제출 자료 생성

수집된 분석 결과 + 사용자 답변을 바탕으로 AI가 다음을 생성한다.

**App Store (`.appship/app-store/<locale>/`)**:

| 산출물 | 제약 |
|---|---|
| 앱 이름 (name.txt) | 30자 |
| 부제목 (subtitle.txt) | 30자 |
| 설명 (description.txt) | 4,000자 |
| 키워드 (keywords.txt) | 100자 |
| 프로모션 문구 (promotional-text.txt) | 170자 |
| 릴리스 노트 (release-notes.txt) | 4,000자 |
| 심사 노트 (review-notes.txt) | 로그인 테스트 계정, 구독/IAP 설명 포함 |

**Google Play (`.appship/google-play/<locale>/`)**:

| 산출물 | 제약 |
|---|---|
| 앱 제목 (title.txt) | 30자 |
| 짧은 설명 (short-description.txt) | 80자 |
| 전체 설명 (full-description.txt) | 4,000자 |
| 릴리스 노트 (release-notes.txt) | 500자 |

추가로 카테고리 제안, 태그 제안, 타깃 연령 제안을 포함한다.

**개인정보 문서**:

- `app-store/privacy/privacy-questionnaire.yml` — Apple 개인정보 설문 초안
- `google-play/data-safety.yml` — Data Safety 초안 (SDK 감지 근거 + 사용자 확인 필요 항목 표시)
- `google-play/content-rating.yml` — 콘텐츠 등급 설문 초안

**법적 문서 (`.appship/legal/`)**:

- `privacy-policy.md`, `terms-of-service.md`, `account-deletion.md`, `support-page.md`

**스크린샷 플랜 (`screenshots/screenshot-plan.yml`)**:

- 화면별 헤드라인 문구 + 소스 라우트 매핑만 생성. **캡처 자동화는 MVP 2**.

```yaml
screenshots:
  - screen: onboarding
    headline: "Start learning through real conversations"
    source_route: src/screens/Onboarding.tsx
```

**체크리스트 (`.appship/checklist/`)**:

- `app-store.md`, `google-play.md` — 스토어별 제출 체크리스트
- `release-readiness.json` — doctor가 소비하는 기계 판독용 상태

플랫폼별 생성도 지원한다: `appship generate ios`, `appship generate android`

### 5.3 `appship doctor` — 제출 준비도 검사

생성물과 프로젝트를 교차 검사하여 리포트를 출력한다.

```
App Store readiness: 82%

✓ Bundle ID configured
✓ App icon found
✓ Privacy manifest found
✓ Microphone usage description found
✗ Support URL missing
✗ Account deletion instructions missing
⚠ Privacy policy does not mention analytics
⚠ Subscription restore flow not detected
```

**검사 카테고리**:

1. **필수 항목 존재** — Support URL, 앱 아이콘, 계정 삭제 안내, PrivacyInfo.xcprivacy 등
2. **글자 수 / 형식** — 스토어별 메타데이터 길이 제한 검증
3. **정책 위반 가능성** — 이모지·반복 특수문자·오해 소지 표현(Google Play 메타데이터 정책), 순위/가격 언급(Apple) 등 패턴 검사
4. **권한 설명 품질** — 권한 usage description이 존재하는지 + **사용 목적이 구체적인지** 평가 및 개선안 제시
5. **불일치 탐지** — 감지된 SDK/권한 ↔ 개인정보 문서 간 모순 (예: Analytics SDK가 있는데 privacy policy에 언급 없음, 회원가입이 있는데 계정 삭제 흐름 없음 → Apple Guideline 5.1.1 리스크)

### 5.4 `.appship/` 출력 폴더 구조

```
.appship/
├── analysis/
│   ├── project.json
│   ├── permissions.json
│   ├── sdk-report.json
│   └── privacy-report.json
├── app-store/
│   ├── en-US/          # name, subtitle, description, keywords,
│   │                   # promotional-text, release-notes, review-notes
│   ├── ko-KR/
│   ├── privacy/
│   │   └── privacy-questionnaire.yml
│   └── screenshots/
│       └── screenshot-plan.yml
├── google-play/
│   ├── en-US/          # title, short-description, full-description, release-notes
│   ├── ko-KR/
│   ├── data-safety.yml
│   ├── content-rating.yml
│   └── screenshots/
├── legal/
│   ├── privacy-policy.md
│   ├── terms-of-service.md
│   ├── account-deletion.md
│   └── support-page.md
└── checklist/
    ├── app-store.md
    ├── google-play.md
    └── release-readiness.json
```

설정 파일 `appship.yml`은 프로젝트 루트에 위치한다 (스키마는 TRD §4.3).

---

## 6. 비범위 (Non-goals) — MVP 1에서 하지 않는 것

| 제외 항목 | 이유 / 시점 |
|---|---|
| 스토어 업로드·제출 (TestFlight, Play Console) | 배포 계층은 Fastlane/스토어 API 연동으로 MVP 2에서 |
| 스크린샷 자동 캡처 (Maestro/Detox 연동) | 플랜 생성까지만 MVP 1, 캡처는 MVP 2 |
| 다국어 번역 (`appship localize`) | MVP 2 |
| Flutter / Native iOS / Native Android 지원 | MVP 3 |
| 심사 거절 메시지 분석 (`appship review analyze`) | MVP 3 |
| CI/CD, GitHub Actions 생성 | MVP 3 |

---

## 7. 로드맵

### MVP 1 (이번 범위)
- React Native 프로젝트 감지·분석 (앱 정보, 권한, SDK)
- App Store / Google Play 메타데이터 생성
- Privacy Policy 등 법적 문서 초안, Data Safety/개인정보 설문 초안
- 스크린샷 플랜 생성
- doctor 제출 준비도 검사
- 명령어: `init`, `generate`, `doctor`

### MVP 2
- 다국어 번역 (`appship localize ko-KR es-AR ja-JP`)
- Fastlane 설정 파일 생성 및 연동
- TestFlight 업로드 (`appship upload ios --testflight`)
- Play Internal Testing 업로드 (`appship upload android --track internal`)
- Maestro 기반 스크린샷 자동 캡처 (`appship screenshots capture`)
- 확인형 제출 (`appship submit`)

### MVP 3
- Flutter, Native iOS/Android 지원
- CI/CD 지원, GitHub Actions 자동 생성
- 스토어 정책 변경 룰 업데이트 체계
- 심사 거절 메시지 분석 및 수정 가이드 (`appship review analyze rejection.txt`)

---

## 8. 성공 지표

| 지표 | 목표 (MVP 1) |
|---|---|
| **생성물 사용률** | 실제 RN 프로젝트에서 `init → generate → doctor` 실행 시, 생성된 메타데이터를 "약간의 수정만으로" 제출에 사용할 수 있는 비율 (자체 도그푸딩 + 초기 사용자 피드백으로 측정) |
| **분석 정확도** | 권한/SDK 감지의 false negative 최소화 — 픽스처 프로젝트 기준 감지율 측정 |
| **doctor 유효성** | doctor가 지적한 항목이 실제 심사 거절 사유와 일치하는 사례 수집 |
| **커뮤니티 반응** | GitHub stars, 이슈/PR을 통한 피드백, "실제 제출에 썼다"는 리포트 |

---

## 9. 경쟁 및 차별화

| | Fastlane | 스토어 콘솔 직접 작업 | **AppShip** |
|---|---|---|---|
| 빌드/서명/업로드 | ✅ | 수동 | MVP 2에서 Fastlane 연동 |
| 메타데이터 **내용 작성** | ❌ (업로드만) | 수동 | ✅ AI 생성 + 검증 |
| 개인정보/Data Safety 초안 | ❌ | 수동 | ✅ 코드 분석 기반 초안 + 근거 |
| 권한↔문서 불일치 탐지 | ❌ | ❌ | ✅ |
| 심사 거절 리스크 사전 검사 | ❌ | ❌ | ✅ doctor |

AppShip은 Fastlane을 **대체하지 않고 보완**한다. AppShip이 "무엇을 제출할지"를 만들고, Fastlane(또는 스토어 API)이 "어떻게 올릴지"를 담당하는 구조가 최종 그림이다.

특히 가치가 큰 차별화 기능 (로드맵 전체 기준):

1. 코드 기반 개인정보 설문 초안 생성
2. 권한과 개인정보 문서 간 불일치 탐지
3. 앱 심사 거절 가능성 사전 검사
4. 스토어별 설명 자동 작성
5. 제출 요구사항 누락 탐지
6. 심사 거절 메시지를 읽고 수정 방법 제안 (MVP 3)
