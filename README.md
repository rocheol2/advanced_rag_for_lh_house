# 🏠 주거복지 FAQ 질의응답 서비스

마이홈포털의 주거복지 FAQ 601건(임대주택 · 주거급여 · 주택금융 · 공공분양 · 공공기숙사)을 근거로
질문에 답하는 **Advanced RAG** 웹 서비스입니다.

사람들이 실제로 궁금해하는 내용을 DB에 담기 위해, [마이홈포털 자주 묻는 질문 페이지](https://www.myhome.go.kr/hws/portal/bbs/selectBoardFAQListView.do)의
FAQ를 **웹 크롤링을 통해 취득**했습니다 (강의에서 배운 크롬 확장프로그램 활용).
크롤링 시 각 질문의 **분류(임대주택 · 주거급여 · 주택금융 · 공공분양 · 공공기숙사)** 를 함께 구분해 Markdown(MD) 파일로 저장했고,
이를 **청킹에 적합한 계층형 MD로 변환**한 뒤 FAQ 문항 단위의 **계층형 청크**로 가공하여 Vector DB에 적재했습니다.

> ### 🌐 배포 서비스: https://rocheol2.github.io/advanced_rag_for_lh_house/
>
> 설치 없이 위 링크에서 바로 사용할 수 있습니다.

## 사용 방법 (3단계)

1. [배포 페이지](https://rocheol2.github.io/advanced_rag_for_lh_house/)에 접속합니다.
2. API Key 2개를 입력합니다.
   - **Cohere API Key** — [발급받기](https://dashboard.cohere.com/api-keys) (무료 trial 키 가능)
   - **OpenRouter API Key** — [발급받기](https://openrouter.ai/keys)
3. 질문을 입력하고 **"질문하기"** 버튼을 누릅니다. (예시 질문 버튼을 눌러도 됩니다)

→ 답변, 처리 요약, Rerank 점수 막대, 근거 FAQ 카드, 1차 검색 후보 20개가 표시됩니다.

**예시 질문**: "다자녀가구 특별공급 당첨자 선정방법은?" · "디딤돌대출 우대금리 요건은?" · "주거급여 지원 대상은 누구인가요?"

## 과제 구현 항목

| 항목 | 구현 내용 |
|---|---|
| 문서 | 마이홈포털 주거복지 FAQ 601건 (크롬 확장프로그램으로 웹 크롤링, 2026-07-05 수집) |
| 청킹 | 크롤링한 MD → 계층형 MD 변환 → FAQ 문항 단위 계층형 청킹 → 614개 chunk |
| Vector DB | Supabase pgvector (1024차원, RPC 유사도 검색) |
| Embedding | Cohere `embed-multilingual-v3.0` |
| Re-Rank | Cohere `rerank-v3.5` (후보 20개 → 상위 5개) |
| Chat Model | OpenRouter 경유 Gemini (`google/gemini-2.5-flash`) |
| RAG 방식 | Advanced RAG (검색 → 재정렬 → 근거 기반 답변) |
| 배포 | GitHub Pages (정적 페이지, 백엔드 서버 없음) |

## RAG 처리 흐름

```mermaid
flowchart LR
    Q[질문 입력] --> E["① Cohere Embedding<br/>(1024차원)"]
    E --> S["② Supabase 검색<br/>(후보 20개)"]
    S --> R["③ Cohere Rerank<br/>(상위 5개)"]
    R --> G["④ Gemini 답변 생성<br/>(OpenRouter)"]
    G --> A[답변 + 근거 표시]
```

## 주요 파일

```
├─ index.html                  # 웹 UI
├─ styles.css                  # 스타일 (카드형 UI + 점수 막대 시각화)
├─ app.js                      # RAG 파이프라인 (브라우저 JavaScript)
├─ data/
│  ├─ myhome-faq-2026-07-05.md      # 크롤링 원본 (계층 MD, 601건)
│  ├─ myhome-faq-hierarchical.md    # 청킹용 계층형 MD (변환본)
│  └─ chunks.json                   # FAQ chunk 614개
├─ scripts/embed_and_upload.py # 임베딩 생성 → Supabase 적재 (구축용, 실행 완료)
└─ supabase/schema.sql         # 테이블 + RPC + 읽기 전용 RLS (구축용, 실행 완료)
```

## 보안

- 사용자가 입력한 API Key는 **저장되지 않으며**(서버·파일·localStorage·cookie 미사용) API 호출에만 사용됩니다.
- 코드에 포함된 Supabase 키는 **공개용(publishable) 키**로, RLS 정책에 의해 FAQ **검색(읽기)만** 가능합니다. (쓰기 시도 시 401 거부 — 검증 완료)
- 쓰기 권한 키(service_role)와 개인 API Key는 저장소에 포함되어 있지 않습니다 (`.gitignore` 차단).

## 검증 결과

- ✅ FAQ 601건 → 614개 chunk 임베딩 및 Supabase 적재 완료 (전 분류, 1~123페이지 전체)
- ✅ 벡터 검색 정확도 확인 (예: "다자녀가구 특별공급 당첨자 선정방법" → 해당 FAQ 1위, similarity 0.86)
- ✅ Rerank 동작 확인 (예: "주거급여 지원 대상" 질문 → 해당 FAQ가 rerank 1위)
- ✅ 공개 키 읽기 전용 동작 확인 (쓰기 401 거부)

---

<details>
<summary><b>🔧 (참고) 처음부터 다시 구축하는 방법</b> — 본 배포에는 이미 완료된 작업이므로 일반 사용자는 볼 필요 없음</summary>

1. **Supabase 스키마 생성**: Supabase SQL Editor에서 [`supabase/schema.sql`](supabase/schema.sql) 실행
   → 테이블(`housing_faq_documents`) + 검색 RPC(`match_housing_faq`) + 읽기 전용 RLS 생성
2. **데이터 적재**: 저장소 루트에 `.env` 생성 후 스크립트 실행
   ```
   # .env (커밋 금지)
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_KEY=service_role키
   COHERE_API_KEY=발급받은키
   ```
   ```bash
   pip install cohere supabase python-dotenv
   python scripts/embed_and_upload.py
   ```
3. **공개 키 설정**: Supabase 대시보드 → Settings → API의 publishable(anon) 키를 `app.js`의 `SUPABASE_ANON_KEY`에 입력
4. **로컬 확인**: `python -m http.server 8080` → http://127.0.0.1:8080
5. **배포**: GitHub 저장소에 push → Settings → Pages → `main` / root 선택

</details>

## 데이터 출처 및 수집 방법

- **출처**: [마이홈포털 자주 묻는 질문(FAQ) 게시판](https://www.myhome.go.kr/hws/portal/bbs/selectBoardFAQListView.do) · 임대주택(405) · 주택금융(93) · 주거급여(55) · 공공분양(29) · 공공기숙사(19)
- **수집 방법**: 사용자들이 실제로 궁금해하는 질문·답변을 RAG DB에 넣기 위해, 강의에서 배운
  **크롬 확장프로그램을 활용한 웹 크롤링**으로 마이홈포털 FAQ 게시판 전체(1~123페이지, 601건)를 수집 (2026-07-05)
  - 크롤링 시 각 질문이 어느 분야에 속하는지 — **임대주택 · 주거급여 · 주택금융 · 공공분양 · 공공기숙사** —
    **분류를 함께 구분해 수집**했으며, 이 분류는 각 chunk의 제목(`[분류] 질문`)과 metadata에 반영되어
    검색 결과 화면에서도 확인할 수 있습니다.
- **가공 절차**:
  1. 크롤링 결과를 Markdown(MD) 파일로 저장 (질문/분류/출처/답변 구조)
  2. 수집된 MD를 **청킹에 적합한 계층형 MD로 변환** (문항별 `## Page NNN. [분류] 질문` → `### 질문/답변/참고정보` 구조로 재구성)
  3. 계층형 MD를 FAQ 문항 단위로 청킹 (긴 답변은 overlap 분할 → 614개 chunk)
  4. 각 chunk를 임베딩하여 Supabase pgvector에 적재
