-- Cache table for bot responses
create table if not exists query_cache (
  id          uuid primary key default gen_random_uuid(),
  query_normalized text not null unique,
  query_original   text not null,
  response_text    text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  hit_count        int not null default 0
);

-- Index for fast lookups by normalized query + expiry
create index if not exists idx_query_cache_lookup
  on query_cache (query_normalized, expires_at);

-- Optional: index for cleaning up expired rows later
create index if not exists idx_query_cache_expires
  on query_cache (expires_at);

alter table query_cache enable row level security;

CREATE POLICY "Allow all for service role" ON query_cache FOR ALL USING (true) WITH CHECK (true);