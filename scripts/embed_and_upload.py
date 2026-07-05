# -*- coding: utf-8 -*-
"""
주거복지 FAQ chunk → Cohere 임베딩 → Supabase 적재 스크립트

- 입력  : data/chunks.json (마이홈포털 FAQ 506개 chunk)
- 임베딩: Cohere embed-multilingual-v3.0 (1024차원, input_type="search_document")
- 대상  : Supabase `housing_faq_documents` 테이블 (supabase/schema.sql로 미리 생성)

사전 준비:
  1. Supabase SQL Editor에서 supabase/schema.sql 실행
  2. 이 저장소 루트에 .env 파일 생성 (절대 커밋 금지):
       SUPABASE_URL=https://xxxx.supabase.co
       SUPABASE_KEY=...        # service_role 키 (쓰기 권한 필요)
       COHERE_API_KEY=...

실행 방법 (저장소 루트에서):
  pip install cohere supabase python-dotenv
  python scripts/embed_and_upload.py
"""

import json
import os
import sys
from pathlib import Path

import cohere
from dotenv import load_dotenv
from supabase import create_client

# ---------------------------------------------------------------
# 설정값
# ---------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
CHUNKS_PATH = REPO_ROOT / "data" / "chunks.json"

EMBED_MODEL = "embed-multilingual-v3.0"  # 1024차원 (schema.sql의 vector(1024)와 일치)
EMBED_BATCH_SIZE = 96                    # Cohere embed API 1회 최대 텍스트 수
INSERT_BATCH_SIZE = 50                   # Supabase insert 배치 크기
TABLE_NAME = "housing_faq_documents"


def load_env() -> tuple[str, str, str]:
    """저장소 루트(또는 상위 폴더)의 .env에서 키를 읽는다."""
    load_dotenv(REPO_ROOT / ".env")
    load_dotenv()  # 혹시 다른 위치에 있으면 기본 탐색으로 한 번 더

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    cohere_key = os.getenv("COHERE_API_KEY")

    missing = [name for name, value in [
        ("SUPABASE_URL", supabase_url),
        ("SUPABASE_KEY", supabase_key),
        ("COHERE_API_KEY", cohere_key),
    ] if not value]
    if missing:
        print(f"[에러] .env에 다음 값이 없습니다: {', '.join(missing)}")
        print(f"       '{REPO_ROOT}' 폴더에 .env 파일을 만들고 키를 넣어주세요.")
        sys.exit(1)
    return supabase_url, supabase_key, cohere_key


def load_chunks() -> list[dict]:
    """data/chunks.json을 읽어 chunk 리스트를 반환한다."""
    if not CHUNKS_PATH.exists():
        print(f"[에러] chunk 파일이 없습니다: '{CHUNKS_PATH}'")
        sys.exit(1)
    with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
        chunks = json.load(f)
    # content가 비어 있는 chunk는 제외
    return [c for c in chunks if (c.get("content") or "").strip()]


def embed_documents(texts: list[str], cohere_key: str) -> list[list[float]]:
    """Cohere embed API로 문서 텍스트들을 배치 임베딩한다."""
    co = cohere.Client(api_key=cohere_key)
    embeddings = []
    total_batches = (len(texts) + EMBED_BATCH_SIZE - 1) // EMBED_BATCH_SIZE
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i:i + EMBED_BATCH_SIZE]
        response = co.embed(
            texts=batch,
            model=EMBED_MODEL,
            input_type="search_document",  # 저장용 문서 임베딩 (질문은 search_query 사용)
        )
        embeddings.extend(response.embeddings)
        print(f"  임베딩 진행: {i // EMBED_BATCH_SIZE + 1}/{total_batches} 배치 완료")
    return embeddings


def upload_to_supabase(records: list[dict], supabase_url: str, supabase_key: str) -> None:
    """레코드를 Supabase 테이블에 배치 insert 한다."""
    supabase = create_client(supabase_url, supabase_key)
    total_batches = (len(records) + INSERT_BATCH_SIZE - 1) // INSERT_BATCH_SIZE
    for i in range(0, len(records), INSERT_BATCH_SIZE):
        batch = records[i:i + INSERT_BATCH_SIZE]
        supabase.table(TABLE_NAME).insert(batch).execute()
        print(f"  적재 진행: {i // INSERT_BATCH_SIZE + 1}/{total_batches} 배치 완료")


def main():
    supabase_url, supabase_key, cohere_key = load_env()

    chunks = load_chunks()
    print(f"[1/3] chunk {len(chunks)}개 로드 완료")

    texts = [c["content"] for c in chunks]
    embeddings = embed_documents(texts, cohere_key)
    assert len(embeddings) == len(chunks), "임베딩 개수가 chunk 개수와 다릅니다."
    print(f"[2/3] Cohere 임베딩 {len(embeddings)}개 생성 완료 (차원: {len(embeddings[0])})")

    # chunk의 부가 정보(chunk_id, slide_title 등)를 metadata(jsonb)로 병합
    records = []
    for chunk, emb in zip(chunks, embeddings):
        records.append({
            "content": chunk["content"],
            "metadata": {
                "chunk_id": chunk.get("chunk_id"),
                "document_name": chunk.get("document_name"),
                "slide_number": chunk.get("slide_number"),
                "slide_title": chunk.get("slide_title"),
                "chunk_index": chunk.get("chunk_index"),
                **(chunk.get("metadata") or {}),
            },
            "embedding": emb,
        })

    upload_to_supabase(records, supabase_url, supabase_key)
    print(f"[3/3] Supabase '{TABLE_NAME}' 테이블에 {len(records)}개 적재 완료!")


if __name__ == "__main__":
    main()
