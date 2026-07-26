-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create news_articles table for RAG layer
CREATE TABLE "news_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "asset_symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- Index for symbol-based lookups (used for quick retrieval by symbol)
CREATE INDEX "idx_news_articles_symbol" ON "news_articles"("asset_symbol", "published_at" DESC);

-- IVFFlat index for approximate nearest neighbor search on embeddings
-- vector_cosine_ops allows cosine similarity via the <=> operator
-- lists=100 is a reasonable default for tables up to ~1M rows
CREATE INDEX "idx_news_articles_embedding" ON "news_articles" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- Add tsvector column auto-maintained by PostgreSQL via generated column
ALTER TABLE "news_articles" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED;

-- GIN index for full-text search (sparse retrieval)
CREATE INDEX "idx_news_articles_fts" ON "news_articles" USING GIN ("search_vector");
