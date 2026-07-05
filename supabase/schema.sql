-- ============================================================
-- 주거복지 FAQ 질의응답 서비스 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor에서 이 파일 전체를 1회 실행하세요.
--
-- 구성:
--   1) pgvector 확장 + FAQ 테이블 (Cohere embed-multilingual-v3.0 = 1024차원)
--   2) 벡터 유사도 검색 RPC 함수
--   3) 공개 읽기 전용 설정 (RLS)
--      → GitHub Pages에 공개되는 anon 키로는 "검색만" 가능하고
--        쓰기/삭제는 불가능하도록 막는다.
-- ============================================================

-- 1) 확장 + 테이블 ---------------------------------------------

create extension if not exists vector;

create table if not exists housing_faq_documents (
    id bigserial primary key,
    content text,
    metadata jsonb,
    embedding vector(1024)   -- Cohere embed-multilingual-v3.0 차원
);

-- 2) 벡터 유사도 검색 RPC 함수 ----------------------------------

create or replace function match_housing_faq (
  query_embedding vector(1024),
  match_count int default 20
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    housing_faq_documents.id,
    housing_faq_documents.content,
    housing_faq_documents.metadata,
    1 - (housing_faq_documents.embedding <=> query_embedding) as similarity
  from housing_faq_documents
  where housing_faq_documents.embedding is not null
  order by housing_faq_documents.embedding <=> query_embedding
  limit match_count;
$$;

-- 3) 공개 읽기 전용 설정 (RLS) ----------------------------------
-- RLS를 켜면 정책이 허용하는 동작만 가능해진다.
-- anon(공개) 키에는 select 정책만 부여 → 웹페이지에서 검색만 가능.
-- 데이터 적재는 service_role 키(RLS 우회)로 로컬에서만 수행한다.

alter table housing_faq_documents enable row level security;

drop policy if exists housing_faq_public_read on housing_faq_documents;
create policy housing_faq_public_read
  on housing_faq_documents
  for select
  to anon
  using (true);

grant usage on schema public to anon;
grant select on housing_faq_documents to anon;
grant execute on function match_housing_faq(vector, int) to anon;
