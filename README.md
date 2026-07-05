# 🏠 주거복지 FAQ 질의응답 서비스

마이홈포털의 주거복지 관련 자주 묻는 질문(FAQ) — 임대주택 · 공공분양 · 주택금융 · 공공기숙사, 총 496개 문항 —
을 기반으로 질문에 답변하는 **Advanced RAG** 웹 서비스입니다.

백엔드 서버 없이 **정적 웹페이지(GitHub Pages)** 만으로 동작하며,
사용자는 **Cohere API Key와 OpenRouter API Key 2개만** 입력하면 됩니다.

## 1. 아키텍처 (Advanced RAG)

```
[브라우저 (GitHub Pages 정적 페이지)]
   │ ① 질문 입력 + Cohere/OpenRouter 키 입력
   ▼
① Cohere embed API — 질문을 1024차원 벡터로 변환 (embed-multilingual-v3.0)
   ▼
② Supabase RPC(match_housing_faq) — 유사 FAQ 후보 20개 검색 (pgvector)
   ▼
③ Cohere Rerank(rerank-v3.5) — 후보를 관련도 순으로 재정렬, 상위 5개 선택
   ▼
④ OpenRouter(google/gemini-2.5-flash) — 문서 근거 기반 한국어 답변 생성
   ▼
⑤ 답변 / 처리 요약 / rerank 점수 막대 / 근거 FAQ 카드 표시
```

- 임베딩과 Rerank를 모두 **Cohere**가 담당하므로 OpenAI 키가 필요 없습니다 (키 2개로 간소화).
- Supabase 접속 정보는 코드에 내장된 **anon(공개용) 키**를 사용하며,
  RLS(Row Level Security)로 **읽기(검색)만 가능**하도록 잠겨 있습니다.

## 2. 프로젝트 구조

```
housing-faq-rag/
├─ index.html                  # 웹 UI
├─ styles.css                  # 스타일 (카드형 UI + CSS 막대 시각화)
├─ app.js                      # RAG 파이프라인 (브라우저 JavaScript)
├─ data/
│  └─ chunks.json              # 마이홈포털 FAQ 청크 506개
├─ scripts/
│  └─ embed_and_upload.py      # Cohere 임베딩 생성 → Supabase 적재 (1회 실행)
├─ supabase/
│  └─ schema.sql               # 테이블 + RPC 함수 + 공개 읽기 RLS 설정
├─ README.md
└─ .gitignore
```

## 3. 배포 준비 (순서대로 1회만)

### 3-1. Supabase 스키마 생성

Supabase 대시보드 → **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql) 전체를 실행합니다.
→ `housing_faq_documents` 테이블(1024차원), `match_housing_faq` RPC 함수, 읽기 전용 RLS가 만들어집니다.

### 3-2. FAQ 데이터 적재 (Cohere 임베딩)

저장소 루트에 `.env` 파일을 만듭니다 (**절대 커밋 금지** — `.gitignore`에 이미 등록됨):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=...        # service_role 키 (쓰기 권한, 로컬에서만 사용)
COHERE_API_KEY=...
```

그다음 실행:

```bash
pip install cohere supabase python-dotenv
python scripts/embed_and_upload.py
```

FAQ 청크 506개가 Cohere `embed-multilingual-v3.0`으로 임베딩되어 Supabase에 적재됩니다.

### 3-3. app.js에 anon 키 넣기

Supabase 대시보드 → **Settings → API** 에서 `anon` `public` 키(또는 publishable 키)를 복사해서
[`app.js`](app.js) 상단의 값을 교체합니다:

```js
const SUPABASE_ANON_KEY = "여기에 anon 키 붙여넣기";
```

> ⚠️ **service_role(secret) 키는 절대 넣지 마세요.** anon 키는 공개되어도
> RLS 설정에 의해 검색(읽기)만 가능하므로 안전합니다.

### 3-4. 로컬에서 확인

```bash
python -m http.server 8080
```

브라우저에서 http://127.0.0.1:8080 접속 → Cohere/OpenRouter 키 입력 → 질문 테스트.

## 4. GitHub Pages 배포

```bash
# GitHub에서 새 저장소 생성 후 (예: housing-faq-rag)
git remote add origin https://github.com/<본인계정>/housing-faq-rag.git
git push -u origin main
```

GitHub 저장소 → **Settings → Pages** →
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)` 선택 → Save

몇 분 후 `https://<본인계정>.github.io/housing-faq-rag/` 에서 서비스가 열립니다.

## 5. 사용 방법

1. 배포된 페이지에 접속합니다.
2. **Cohere API Key** ([발급](https://dashboard.cohere.com/api-keys), 무료 trial 키 가능)와
   **OpenRouter API Key** ([발급](https://openrouter.ai/keys))를 입력합니다.
3. 질문을 입력하거나 예시 질문 버튼을 누르고 **"질문하기"**를 클릭합니다.
4. 답변 → 처리 요약 → Rerank 점수 막대 → 근거 FAQ 카드 → 1차 검색 후보 순으로 결과가 표시됩니다.

예시 질문:
- "다자녀가구 특별공급 당첨자 선정방법은?"
- "디딤돌대출 우대금리 요건은?"
- "행복주택 입주 자격이 궁금해요"

## 6. 보안 주의사항

- 사용자가 입력한 Cohere/OpenRouter 키는 **저장되지 않고** API 요청에만 사용됩니다
  (localStorage · sessionStorage · cookie · 서버 미사용 — 서버 자체가 없음).
- 코드에 내장된 Supabase anon 키는 공개용 키이며, RLS로 읽기 전용으로 제한됩니다.
- `.env`(service_role 키 포함)는 `.gitignore`로 커밋이 차단되어 있습니다.
- GitHub에 올리기 전 `git status`로 `.env`가 목록에 없는지 한 번 더 확인하세요.

## 7. 문제 해결

| 증상 | 해결 |
|---|---|
| "관리자 설정 필요: SUPABASE_ANON_KEY..." | 3-3 단계 수행 (anon 키 교체) |
| "질문 embedding 생성 중 오류" / "Cohere Rerank 처리 중 오류" | Cohere API Key 확인. trial 키는 분당 호출 제한이 있으므로 잠시 후 재시도 |
| "Supabase 검색 중 오류 (RPC: match_housing_faq)" | 3-1 단계의 schema.sql 실행 여부 확인 |
| "검색 결과가 없습니다" | 3-2 단계의 데이터 적재 실행 여부 확인 |
| "OpenRouter 답변 생성 중 오류" | OpenRouter 키/크레딧 확인. 무료 모델을 쓰려면 app.js의 `CHAT_MODEL`을 `:free` 모델 ID로 변경 |
| GitHub Pages에서 404 | Settings → Pages 설정 확인, 반영까지 수 분 소요 |

## 8. 데이터 출처

- [마이홈포털](https://www.myhome.go.kr) 자주 묻는 질문(FAQ), 2026-07-05 수집
- 분류: 임대주택(404) · 주택금융(44) · 공공분양(29) · 공공기숙사(19)
