// ============================================================
// 주거복지 FAQ 질의응답 서비스 — Advanced RAG (브라우저 단독 실행)
//
// 처리 흐름:
//   1) 질문을 Cohere embed API로 벡터화 (embed-multilingual-v3.0, 1024차원)
//   2) Supabase RPC(match_housing_faq)로 유사 FAQ 후보 20개 검색
//   3) Cohere Rerank(rerank-v3.5)로 재정렬 후 상위 5개 선택
//   4) OpenRouter(Gemini)로 문서 근거 기반 답변 생성
//
// 보안:
//   - 아래 SUPABASE_ANON_KEY는 "공개용(anon/publishable)" 키만 넣어야 한다.
//     (schema.sql의 RLS 설정으로 이 키는 읽기/검색만 가능)
//   - service_role 키는 절대 이 파일에 넣지 말 것!
//   - 사용자가 입력한 Cohere/OpenRouter 키는 저장하지 않고
//     요청을 보낼 때만 메모리에서 사용한다.
// ============================================================

// ----- 설정값 -----------------------------------------------
const SUPABASE_URL = "https://uhvvyqxqcwwjnlmimcit.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LTz9CgFSxdA1pVLtLm010g_jqcBpvZy"; // 공개용(publishable) 키 — RLS로 읽기 전용

const EMBED_MODEL = "embed-multilingual-v3.0"; // Cohere 임베딩 모델 (1024차원)
const RERANK_MODEL = "rerank-v3.5";            // Cohere Rerank 모델
const CHAT_MODEL = "google/gemini-2.5-flash";  // OpenRouter 경유 Gemini 모델
const RPC_FUNCTION = "match_housing_faq";      // Supabase 벡터 검색 RPC 함수
const CANDIDATE_COUNT = 20;                    // 1차 검색 후보 수
const FINAL_TOP_N = 5;                         // Rerank 후 사용할 FAQ 수

const SYSTEM_PROMPT =
  "너는 주거복지 FAQ 기반 질의응답 도우미입니다.\n" +
  "아래 제공된 FAQ 문서 내용만 근거로 사용해서 질문에 답하세요.\n" +
  "문서에서 확인되지 않는 내용은 추측하지 말고 '문서에서 확인되지 않습니다'라고 답하세요.\n" +
  "답변은 한국어로 작성하세요.\n" +
  "가능하면 근거가 되는 FAQ의 제목(slide_title)을 함께 언급하세요.";

// ----- 유틸리티 ---------------------------------------------

// HTML 이스케이프 (FAQ 내용을 안전하게 표시)
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

// 소수점 4자리 표시
function fmt(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(4);
}

// 예시 질문 버튼 클릭 시 질문창에 입력
function setExample(btn) {
  document.getElementById("question").value = btn.textContent;
}

function showError(message) {
  const box = document.getElementById("error-box");
  box.textContent = "⚠️ " + message;
  box.classList.remove("hidden");
}

function setLoading(visible, text) {
  const loading = document.getElementById("loading");
  loading.classList.toggle("hidden", !visible);
  if (text) document.getElementById("loading-text").textContent = text;
}

// ----- 1) 질문 embedding (Cohere) ----------------------------
async function embedQuery(query, cohereKey) {
  const response = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + cohereKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      texts: [query],
      input_type: "search_query", // 검색 질문용 임베딩
      embedding_types: ["float"],
    }),
  });
  if (!response.ok) {
    throw new Error("질문 embedding 생성 중 오류가 발생했습니다. Cohere API Key를 확인하세요.");
  }
  const data = await response.json();
  return data.embeddings.float[0];
}

// ----- 2) Supabase 벡터 검색 (RPC) ----------------------------
async function searchChunks(queryEmbedding) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${RPC_FUNCTION}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: CANDIDATE_COUNT,
    }),
  });
  if (!response.ok) {
    throw new Error(`Supabase 검색 중 오류가 발생했습니다. (RPC: ${RPC_FUNCTION})`);
  }
  const rows = await response.json();
  if (!rows || rows.length === 0) {
    throw new Error("검색 결과가 없습니다. Supabase에 FAQ 데이터가 적재되어 있는지 확인하세요.");
  }
  // content가 비어 있는 행은 제외
  return rows.filter((r) => (r.content || "").trim().length > 0);
}

// ----- 3) Cohere Rerank --------------------------------------
async function rerankChunks(query, rows, cohereKey) {
  const response = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + cohereKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RERANK_MODEL,
      query: query,
      documents: rows.map((r) => r.content),
      top_n: Math.min(FINAL_TOP_N, rows.length),
    }),
  });
  if (!response.ok) {
    throw new Error("Cohere Rerank 처리 중 오류가 발생했습니다. Cohere API Key를 확인하세요.");
  }
  const data = await response.json();
  // rerank 결과 순서대로 원본 행에 rank / rerank_score를 붙여 반환
  return data.results.map((item, i) => ({
    ...rows[item.index],
    rank: i + 1,
    rerank_score: item.relevance_score,
  }));
}

// ----- 4) context 구성 + OpenRouter(Gemini) 답변 생성 ----------
function buildContext(rankedRows) {
  return rankedRows
    .map((row, i) => {
      const meta = row.metadata || {};
      return (
        `[근거 ${i + 1}]\n` +
        `slide_title: ${meta.slide_title || "-"}\n` +
        `rerank_score: ${fmt(row.rerank_score)}\n` +
        `content: ${row.content}`
      );
    })
    .join("\n\n");
}

async function generateAnswer(query, context, openrouterKey) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + openrouterKey,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin, // OpenRouter 권장 헤더 (출처 표시)
      "X-Title": "Housing FAQ RAG",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `다음은 검색된 주거복지 FAQ 문서입니다.\n\n${context}\n\n` +
            `위 문서 내용만 근거로 다음 질문에 한국어로 답하세요.\n\n질문: ${query}`,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error("OpenRouter 답변 생성 중 오류가 발생했습니다. OpenRouter API Key와 크레딧을 확인하세요.");
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

// ----- 결과 렌더링 --------------------------------------------
function renderResults(answer, candidates, ranked) {
  document.getElementById("answer").textContent = answer;

  // 처리 요약 (평균값 계산)
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const sims = ranked.map((r) => r.similarity).filter((v) => v != null);
  const scores = ranked.map((r) => r.rerank_score).filter((v) => v != null);

  document.getElementById("summary-retrieved").textContent = candidates.length + "개";
  document.getElementById("summary-reranked").textContent = ranked.length + "개";
  document.getElementById("summary-avg-sim").textContent = fmt(avg(sims));
  document.getElementById("summary-avg-rerank").textContent = fmt(avg(scores));

  // rerank 점수 막대 (CSS bar)
  document.getElementById("rerank-bars").innerHTML = ranked
    .map((row) => {
      const meta = row.metadata || {};
      const width = Math.max(2, Math.min(100, (row.rerank_score || 0) * 100));
      return `
        <div class="bar-row">
          <div class="bar-label" title="${escapeHtml(meta.slide_title)}">
            <span class="bar-rank">${row.rank}위</span> ${escapeHtml(meta.slide_title || "-")}
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <div class="bar-score">${fmt(row.rerank_score)}</div>
        </div>`;
    })
    .join("");

  // 근거 FAQ 카드 (상위 5개)
  document.getElementById("used-chunks").innerHTML = ranked
    .map((row) => {
      const meta = row.metadata || {};
      const content = row.content || "";
      return `
        <div class="chunk-card">
          <div class="chunk-header">
            <span class="chunk-rank">Rank ${row.rank}</span>
            <span class="chunk-meta-item">id: ${escapeHtml(row.id)}</span>
            <span class="chunk-score sim">similarity: ${fmt(row.similarity)}</span>
            <span class="chunk-score rerank">rerank_score: ${fmt(row.rerank_score)}</span>
          </div>
          <div class="chunk-title">${escapeHtml(meta.slide_title || "-")}</div>
          <div class="chunk-content">${escapeHtml(content.slice(0, 700))}${content.length > 700 ? "…" : ""}</div>
          <details class="metadata-details">
            <summary>metadata 보기</summary>
            <pre>${escapeHtml(JSON.stringify(meta, null, 2))}</pre>
          </details>
        </div>`;
    })
    .join("");

  // 1차 검색 후보 (접기/펼치기)
  document.getElementById("candidate-count").textContent = candidates.length;
  document.getElementById("candidate-chunks").innerHTML = candidates
    .map((row, i) => {
      const content = row.content || "";
      return `
        <div class="candidate-row">
          <div class="candidate-head">
            <span class="candidate-index">#${i + 1}</span>
            <span class="chunk-meta-item">id: ${escapeHtml(row.id)}</span>
            <span class="chunk-score sim">similarity: ${fmt(row.similarity)}</span>
          </div>
          <div class="candidate-content">${escapeHtml(content.slice(0, 300))}${content.length > 300 ? "…" : ""}</div>
        </div>`;
    })
    .join("");

  const results = document.getElementById("results");
  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ----- 메인 실행 ----------------------------------------------
async function runRag() {
  const errorBox = document.getElementById("error-box");
  const runBtn = document.getElementById("run-btn");
  errorBox.classList.add("hidden");
  document.getElementById("results").classList.add("hidden");

  const question = document.getElementById("question").value.trim();
  const cohereKey = document.getElementById("cohere-key").value.trim();
  const openrouterKey = document.getElementById("openrouter-key").value.trim();

  // 입력값 검증
  if (!question) return showError("질문을 입력하세요.");
  const missing = [];
  if (!cohereKey) missing.push("Cohere API Key");
  if (!openrouterKey) missing.push("OpenRouter API Key");
  if (missing.length > 0) return showError(`다음 입력값이 누락되었습니다: ${missing.join(", ")}`);
  if (SUPABASE_ANON_KEY.startsWith("PASTE_")) {
    return showError("관리자 설정 필요: app.js의 SUPABASE_ANON_KEY에 Supabase anon(publishable) 키를 넣어주세요.");
  }

  runBtn.disabled = true;
  try {
    setLoading(true, "1/4 질문 embedding 생성 중... (Cohere)");
    const embedding = await embedQuery(question, cohereKey);

    setLoading(true, "2/4 Supabase에서 후보 FAQ 검색 중...");
    const candidates = await searchChunks(embedding);

    setLoading(true, "3/4 Cohere Rerank로 재정렬 중...");
    const ranked = await rerankChunks(question, candidates, cohereKey);

    setLoading(true, "4/4 Gemini 답변 생성 중... (OpenRouter)");
    const context = buildContext(ranked);
    const answer = await generateAnswer(question, context, openrouterKey);

    renderResults(answer, candidates, ranked);
  } catch (e) {
    showError(e.message || "처리 중 오류가 발생했습니다.");
  } finally {
    setLoading(false);
    runBtn.disabled = false;
  }
}
