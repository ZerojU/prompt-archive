# GitHub Prompt Archive

AI 프롬프트를 체계적으로 보관·탐색·편집·공유하기 위한 **정적 웹 애플리케이션**입니다. 백엔드 서버 없이 GitHub Pages 위에서 동작합니다.

---

## 1. 프로젝트 소개

GitHub Prompt Archive는 `/prompts` 디렉터리에 저장된 HTML 프롬프트 파일을 폴더 구조 기반으로 자동 탐색하여 좌측 사이드바 메뉴로 제공하는 정적 사이트입니다. 서버 사이드 런타임 없이 정적 파일(HTML/CSS/JS)과 정적 데이터만으로 동작하며, 모든 데이터 조회는 브라우저가 정적 파일을 `fetch`하여 수행합니다.

주요 기능은 다음과 같습니다.

- **탐색**: `/prompts` 폴더 구조를 최대 2단계(2-depth) 메뉴로 자동 구성 (빌드 시 생성되는 `manifest.json` 기반, 코드에 목록 하드코딩 없음)
- **표시**: 선택한 프롬프트 본문을 사람이 읽기 좋은 안전한 텍스트로 표시 (HTML 원본 코드 노출 안 함)
- **복사**: 프롬프트 전체를 서식 없는 일반 텍스트로 클립보드에 복사
- **편집 + 실시간 Diff**: 좌(원본, 읽기 전용) / 우(편집) 2분할 화면에서 수정하며 원본 대비 변경 내용을 실시간으로 시각화
- **다운로드**: 원본 HTML 구조를 보존한 채 프롬프트 영역만 교체한 수정본을 클라이언트에서 생성해 다운로드 (외부 서버 전송 없음)
- **자동 배포**: 기본 브랜치에 새 프롬프트 HTML을 push하면 GitHub Actions가 manifest 재생성 → 빌드 → Pages 배포를 자동 수행

구현은 바닐라 HTML/CSS/JS를 기본으로 하고 Vite를 빌드 도구로 사용합니다. 런타임 외부 라이브러리는 **diff 처리(`diff`)** 와 **HTML 정화(`dompurify`)** 두 목적에만 한정합니다.

---

## 2. 디렉터리 구조

```
github-prompt-archive/
├─ index.html                      # 앱 진입점 (Header / Sidebar / Main 셸)
├─ package.json                    # 스크립트 및 의존성 (diff, dompurify / vite, vitest …)
├─ vite.config.js                  # base(VITE_BASE) 주입, 정적 데이터 복사 플러그인, Vitest 설정
├─ README.md                       # 본 문서
├─ config/
│  └─ category.json                # 영문 폴더/파일 경로 → 한글 Display_Name 매핑
├─ prompts/                        # Prompt_File 루트 (.html만 메뉴에 포함)
│  ├─ backend/
│  │  ├─ spring.html
│  │  └─ database/
│  │     └─ postgres.html
│  └─ frontend/
│     └─ react-hooks.html
├─ public/                         # 가공 없이 dist 루트로 복사되는 정적 자산
│  └─ manifest.json                # generate-manifest.js 가 생성 (빌드 산출물, 커밋 대상 아님)
├─ scripts/
│  └─ generate-manifest.js         # /prompts 스캔 → public/manifest.json 생성
├─ src/
│  ├─ main.js                      # 앱 셸 와이어링: Base_URL → 로드 → 렌더 → 이벤트 바인딩
│  ├─ styles/
│  │  └─ app.css                   # Header/Sidebar/Main 레이아웃, 768px 반응형
│  ├─ components/
│  │  ├─ Sidebar.js                # 2-depth 카테고리/프롬프트 네비게이션
│  │  ├─ PromptViewer.js           # 표시 / 복사 / 액션 버튼 / 원본 보기
│  │  ├─ PromptEditor.js           # 2분할 편집 (원본 readonly + 에디터)
│  │  └─ DiffViewer.js             # 실시간 diff 시각화
│  ├─ services/
│  │  ├─ manifestLoader.js         # manifest + category.json 로드 및 Display_Name 병합
│  │  ├─ promptLoader.js           # 프롬프트 fetch(10초 타임아웃) + 콘텐츠 추출
│  │  ├─ sanitizer.js              # DOMPurify 래퍼 (XSS 정화)
│  │  ├─ downloadService.js        # 수정본 HTML 생성 + Blob 다운로드
│  │  └─ writeBackService.js       # Phase 5 write-back 확장 지점 (구조만)
│  └─ utils/
│     ├─ path.js                   # Base_URL 계산 / URL 결합 (순수 함수)
│     └─ diff.js                   # jsdiff 래퍼 computeDiff (순수 함수)
├─ test/                           # Vitest 단위/속성 테스트
└─ .github/
   └─ workflows/
      └─ deploy.yml                # GitHub Actions 배포 파이프라인
```

> **설계 노트 — 데이터/코드 분리**: 메뉴 데이터(`manifest.json`)와 표시명 매핑(`config/category.json`)은 소스 코드와 분리된 정적 데이터로 유지됩니다. 덕분에 프롬프트나 메뉴명을 바꿀 때 코드를 재작성할 필요가 없습니다. `manifest.json`은 빌드 산출물이므로 저장소에 커밋하지 않고 빌드/배포 시 재생성됩니다.

---

## 3. 프롬프트 추가 방법

1. `prompts/<카테고리>/[하위카테고리]/<이름>.html` 경로에 HTML 파일을 추가합니다. (`.html` 확장자만 메뉴에 포함되며, 그 외 확장자는 제외됩니다.)
2. 아래 **권장 구조**를 따릅니다.
   - `<title>` — 메뉴에 표시될 제목 추출원입니다. 없으면 첫 `<h1>`, 그래도 없으면 확장자를 제외한 파일명이 제목으로 사용됩니다.
   - `<meta name="category" content="...">` — 소속 카테고리(전체 경로)를 명시합니다.
   - `<article class="prompt"><section class="prompt-content">…</section></article>` — 이 `section.prompt-content` 영역의 텍스트만 뷰어에 표시되고 다운로드 시 교체됩니다. 권장 구조가 없으면 `body` 전체에서 본문을 추출합니다.
3. 기본 브랜치에 push하면 배포 과정에서 manifest가 재생성되어 새 프롬프트가 **자동으로** 메뉴에 노출됩니다. 로컬에서는 `npm run dev`(또는 `npm run build`)가 선행 스크립트로 manifest를 다시 만듭니다.

최소 프롬프트 HTML 템플릿:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>프롬프트 제목</title>                 <!-- 메뉴 제목 추출원 -->
  <meta name="category" content="backend">    <!-- 소속 카테고리(전체 경로) -->
</head>
<body>
  <article class="prompt">
    <h1>프롬프트 제목</h1>
    <section class="prompt-content">여기에 프롬프트 본문을 작성합니다.
여러 줄과 줄바꿈이 그대로 보존됩니다.</section>
  </article>
</body>
</html>
```

---

## 4. 카테고리 추가 방법

카테고리는 별도 설정이 아니라 `prompts/` 아래의 **폴더 구조** 그 자체로 결정됩니다.

- `prompts/` 바로 아래 폴더 → 1단계(1-depth) 카테고리
- 그 안의 폴더 → 2단계(2-depth) 하위 카테고리
- 새 카테고리를 만들려면 해당 폴더를 생성하고 그 안에 프롬프트 `.html`을 넣으면 됩니다.

메뉴는 **최대 2단계까지만** 표현합니다. 3단계 이상 깊이에 위치한 프롬프트 파일은 소실되지 않고 **가장 가까운 2단계 상위 카테고리로 승격 소속**됩니다. 예를 들어 `prompts/backend/database/deep/pg.html`은 2단계인 `backend/database` 카테고리에 속합니다.

예시 구조:

```
prompts/
├─ backend/            # 1-depth
│  ├─ spring.html
│  └─ database/        # 2-depth
│     └─ postgres.html
└─ frontend/           # 1-depth (하위 폴더 없음 → 프롬프트 직접 표시)
   └─ react-hooks.html
```

---

## 5. 한글 메뉴명 변경 방법

파일 시스템은 영문 폴더명으로 유지하면서 사용자에게 보이는 메뉴명은 한글로 바꿀 수 있습니다. `config/category.json`(Category_Config)을 편집합니다.

- 키는 **root(`prompts/`) 기준 전체 상대 경로**입니다. 동일한 폴더명이 서로 다른 depth에 있어도 전체 경로로 구분되어 독립 해석됩니다.
- `folders` — 폴더 경로 → 한글 Display_Name 매핑 (권장)
- `files` — (선택) 파일 경로 → Display_Name 매핑
- **매핑 우선순위**: 폴더 매핑이 1순위입니다. 폴더 매핑과 파일 매핑이 동시에 존재하면 폴더 매핑이 우선 적용됩니다.
- 매핑이 없는 폴더는 **영문 폴더명을 그대로 폴백** 표시합니다. 파일이 없거나 JSON이 malformed이면 매핑을 적용하지 않고 전부 영문으로 폴백하며 오류 표시를 제공합니다.

스키마와 예시:

```json
{
  "folders": {
    "backend": "백엔드",
    "backend/database": "데이터베이스",
    "frontend": "프런트엔드"
  },
  "files": {
    "backend/spring.html": "스프링 부트 API 리뷰"
  }
}
```

---

## 6. 로컬 실행 방법

**사전 요건**: Node.js(및 npm)가 설치되어 있어야 합니다. 운영체제에 따라 Node.js 실행 파일이 PATH 환경 변수에 등록되어 있어야 하며, Windows/PowerShell에서 `node`/`npm` 명령이 인식되지 않으면 Node.js를 PATH에 추가하거나 새 셸을 열어 다시 시도하세요.

의존성 설치:

```bash
npm install
```

개발 서버 실행 (`predev` 스크립트가 먼저 manifest를 재생성한 뒤 Vite 개발 서버를 띄웁니다):

```bash
npm run dev
```

프로덕션 빌드 미리보기 (`prebuild`가 manifest를 재생성하고 Vite 빌드 후, 빌드 결과를 로컬에서 서빙):

```bash
npm run build
npm run preview
```

테스트 실행:

```bash
npm test
```

> 위 명령은 `package.json`의 scripts와 정확히 일치합니다: `predev`/`prebuild`는 `node scripts/generate-manifest.js`를 선행하고, `dev`=`vite`, `build`=`vite build`, `preview`=`vite preview`, `test`=`vitest run`.

---

## 7. GitHub Pages 배포 방법

1. 저장소 설정의 **Settings → Pages**에서 소스를 **GitHub Actions**로 설정합니다.
2. 기본 브랜치(default branch)에 변경 사항을 push합니다. push가 감지되면 배포 워크플로가 트리거되어 빌드하고 Pages에 배포합니다.
3. 프로젝트 페이지(`username.github.io/<repo>/`)로 배포되는 경우, 워크플로가 저장소 이름을 기반으로 `VITE_BASE=/<repo>/`를 주입하여 하위 경로에서 리소스가 올바르게 로드되도록 합니다. 사용자 페이지 루트나 로컬에서는 상대 기준(`./`)으로 폴백합니다.

> **기본 브랜치 가정**: 워크플로(`deploy.yml`)는 기본 브랜치가 `main`이라고 가정합니다. 저장소의 기본 브랜치가 `master`(또는 그 외)라면 `deploy.yml`의 `on.push.branches` 값을 실제 기본 브랜치명으로 변경하세요.

---

## 8. GitHub Actions 동작 방식

배포 파이프라인은 `.github/workflows/deploy.yml`에 정의되어 있습니다.

- **트리거**: 기본 브랜치(`main`)에 대한 push, 그리고 Actions 탭에서의 수동 실행(`workflow_dispatch`). 기본 브랜치가 아닌 다른 브랜치 push는 트리거되지 않습니다.
- **단계 순서(고정, 게이팅)**:
  1. 저장소 체크아웃 → Node.js 20 설정 → `npm ci`로 의존성 설치
  2. **manifest 재생성** (`node scripts/generate-manifest.js`)
  3. **Vite 빌드** (`npm run build`, `VITE_BASE=/<repo>/` 주입)
  4. Pages 환경 구성 → `dist/` 아티팩트 업로드
  5. **Pages 배포** (`deploy` 잡이 `build` 잡에 `needs`로 의존)
- **빌드 실패 게이팅**: `deploy` 잡이 `build` 잡 성공에 의존하므로, manifest 재생성이나 빌드가 실패하면 배포 잡은 실행되지 않고 **기존에 배포된 사이트가 그대로 유지**되며 파이프라인은 실패로 종료됩니다.
- 권한은 `pages: write`, `id-token: write`를 사용하고, 동시 배포 충돌을 막기 위해 `concurrency: group: pages`로 직렬화합니다.
- 배포가 성공하면 재생성된 manifest 덕분에 새로 추가한 프롬프트가 사이드바 메뉴에 자동 노출됩니다.

---

## 9. HTML 다운로드 방식

수정본 다운로드는 전적으로 **브라우저(클라이언트)에서만** 수행되며 어떤 외부 서버로도 데이터를 전송하지 않습니다.

- **생성**: `Blob` API로 수정본 HTML을 만들고 `a[download]` 요소로 브라우저 다운로드를 시작합니다.
- **구조 보존**: 원본 문서의 doctype 선언, head 영역, 프롬프트 영역 외부의 모든 마크업과 공백·줄바꿈·문자 인코딩을 **바이트 단위로 보존**하고, `section.prompt-content` 영역의 텍스트만 수정된 텍스트로 교체합니다.
- **이스케이프**: 수정 텍스트의 HTML 특수문자(`< > & " '`)를 대응하는 HTML 엔티티로 이스케이프하여 교체하므로 원본 문서 구조가 깨지지 않습니다.
- **파일명**: 원본 확장자 앞에 `_modified` 접미사를 붙여 제안합니다. 예: `spring.html` → `spring_modified.html`.
- **예외**: 원본에서 프롬프트 콘텐츠 영역을 식별할 수 없으면 다운로드를 수행하지 않고 오류를 표시하며 원본 데이터는 그대로 둡니다.

> **설계 노트 — Diff_Library 채택 근거**: 실시간 diff는 직접 구현(hand-rolled) 대신 **번들링된 검증 라이브러리 jsdiff(`diff` 패키지)** 를 사용합니다. 이유는 다음과 같습니다 — (1) 검증된 단어/줄 단위 세그먼트 분할을 신뢰성 있게 제공하고, (2) 번들 크기가 작으며, (3) `{value, added, removed}` 형태의 세그먼트 배열을 그대로 추가/삭제/미변경 강조에 매핑할 수 있어 DiffViewer 연동이 단순합니다. 또한 `src/utils/diff.js`가 라이브러리를 추상화하므로, 필요하면 diff-match-patch 등 다른 구현으로 교체할 수 있습니다.

---

## 10. GitHub에 직접 수정본을 저장하지 않는 이유

초기 전달 범위(Phase 1-3)에서는 수정본을 **다운로드한 뒤 사용자가 수동으로 커밋**하는 방식을 제공합니다. GitHub에 직접 쓰기(write-back)를 기본 제공하지 않는 이유는 다음과 같습니다.

- GitHub Pages는 **정적 호스팅**이라 백엔드가 없습니다. 저장소에 파일을 쓰려면 GitHub API 호출과 **인증(OAuth/토큰)** 이 필요합니다.
- 토큰을 안전하게 다루려면 사용자 런타임 인증 흐름(OAuth 동의 또는 메모리에만 보관하는 사용자 입력 토큰)이 필요하며, 이는 Phase 5의 범위입니다. 토큰을 소스에 하드코딩하는 것은 금지됩니다.
- 따라서 현재 버전은 다운로드 → 수동 커밋 방식을 채택하고, 미래의 직접 쓰기를 수용할 수 있도록 코드 구조만 분리해 두었습니다.

---

## 11. 향후 GitHub API 연동 방법

향후 "GitHub에 저장" 기능은 `src/services/writeBackService.js`의 **구조적 확장 지점(hook)** 을 통해 기존 호출부를 바꾸지 않고 추가할 수 있습니다.

- `WriteBackProvider` 인터페이스는 `saveToGitHub(path, content, options)` 메서드 하나로 정의됩니다.
- 기본 제공 구현(`downloadWriteBackProvider`)은 네트워크·인증 없이 `manual-download` 결과를 반환하는 no-op으로, 현재의 다운로드-수동 커밋 워크플로를 나타냅니다.
- 미래의 OAuth/토큰 기반 provider는 `setWriteBackProvider(provider)`로 등록하면 활성화됩니다. 호출부는 `getWriteBackProvider()`로 활성 provider를 얻어 사용하므로 변경이 필요 없습니다. `resetWriteBackProvider()`로 기본 provider로 되돌릴 수 있습니다.
- 어떤 provider든 **인증 정보는 사용자 런타임 인증(인터랙티브 OAuth 또는 메모리에만 보관하는 사용자 입력 토큰)에서 가져와야 하며, 토큰/시크릿을 소스 코드에 절대 하드코딩하지 않습니다.**

---

## 12. 보안 유의사항

- **HTML 정화(XSS 방어)**: 신뢰할 수 없는 Prompt_File HTML은 `src/services/sanitizer.js`(DOMPurify 래퍼)로 정화한 뒤에만 DOM에 삽입합니다. `script`/`iframe`/`object`/`embed` 태그, `on*` 인라인 이벤트 핸들러, `javascript:`/`data:`/`vbscript:` 위험 URL 스킴을 제거하고 교차 출처 외부 스크립트 로드를 차단합니다. 정화 불가 시 원본을 주입하지 않고 빈/안전한 텍스트로 대체합니다.
- **안전한 텍스트 표시**: 프롬프트 본문은 `textContent` 기반의 안전한 텍스트 표시로 렌더링하여 `< > & " '` 문자가 리터럴로 보이게 하고, 원본 소스 코드가 실행되지 않도록 합니다.
- **다운로드 이스케이프**: 수정 텍스트를 영역에 치환할 때 다섯 특수문자를 HTML 엔티티로 이스케이프하여 원본 구조 손상을 방지합니다.
- **토큰 비하드코딩**: 개인 접근 토큰(PAT) 등 어떤 시크릿도 소스에 하드코딩하지 않습니다. write-back은 구조적 hook만 제공합니다.
- **신뢰 저장소 전제**: 본 아카이브는 개인/신뢰 가능한 저장소에서 운영한다고 가정합니다. 공개 기여를 받는 경우 프롬프트 파일 콘텐츠를 리뷰하는 절차를 권장합니다.
- **CSP 권장(선택)**: 가능하면 `index.html`에 보수적인 CSP 메타 태그를 추가하여 인라인/외부 스크립트 실행을 추가로 제한할 수 있습니다.

---

## 부록 — 설계 근거: 폴더 자동 탐색 방식 비교 (채택: manifest.json)

정적 호스팅은 런타임에 디렉터리를 나열할 수 없습니다(GitHub Pages는 서버 디렉터리 리스팅을 제공하지 않습니다). 폴더 구조를 메뉴로 바꾸는 세 가지 후보를 비교하고 `manifest.json`을 채택한 근거는 다음과 같습니다.

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| **GitHub Contents API** (런타임에 REST API로 폴더 조회) | 저장소 상태를 실시간 반영 | 비인증 API rate limit(시간당 60요청), 토큰 필요 가능, 외부 네트워크 의존·지연, 사설 저장소 조회 제약 → "백엔드 없는 순수 정적" 원칙과 상충 |
| **빌드 타임 파일 목록**(목록을 소스/번들에 직접 주입) | 추가 요청 없음, 단순 | 데이터가 코드에 섞여 "목록 하드코딩 금지" 위반, 데이터 변경 시 코드 재빌드 필요 |
| **manifest.json (채택)** | 추가 요청 **1회**로 전체 트리 획득, 데이터/코드 분리, 재빌드 없이 데이터만 교체 가능, rate limit·외부 의존 없음 | 빌드 단계가 필요(이미 Vite 빌드가 있어 비용 미미) |

**채택 근거 요약**: Contents API는 rate limit·토큰·외부 네트워크 의존을 유발해 정적·의존 최소화 원칙과 충돌하고, 빌드 타임 코드 주입은 데이터를 코드에 섞어 목록 하드코딩 금지를 위반합니다. `manifest.json`은 기존 Vite 빌드 파이프라인에 생성 단계만 추가하면 되고, 데이터와 코드를 분리하며, **1회 fetch로 전체 Category_Tree**를 얻을 수 있어 정적 호스팅의 디렉터리 리스팅 부재 문제를 가장 깔끔하게 해결합니다.
