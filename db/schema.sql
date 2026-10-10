create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  active_org_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('personal','team')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','member','viewer')),
  subject_ref text,             -- e.g. student ID / employee ID for row-level security
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists invites (
  code text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  role text not null check (role in ('admin','manager','member','viewer')),
  subject_ref text,
  created_by uuid references users(id) on delete set null,
  max_uses int not null default 1,
  uses int not null default 0,
  expires_at timestamptz not null default now() + interval '7 days'
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  title text not null,
  source text not null default 'upload',
  mime text not null default 'text/plain',
  visibility text not null check (visibility in ('private','org','roles')),
  allowed_roles text[] not null default '{}',
  chunk_count int not null default 0,
  quarantined_chunks int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists documents_org_idx on documents(org_id);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  org_id uuid not null,
  idx int not null,
  content text not null,
  subject_ref text,
  quarantined boolean not null default false,
  risk real not null default 0,
  embedding vector(384) not null,
  tsv tsvector generated always as (to_tsvector('simple', content)) stored
);
create index if not exists chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_tsv_gin on chunks using gin (tsv);
create index if not exists chunks_org_idx on chunks(org_id);
create index if not exists chunks_subject_idx on chunks(subject_ref);
create index if not exists chunks_doc_idx on chunks(document_id);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  org_id uuid references orgs(id) on delete cascade,
  provider text not null,
  label text not null,
  base_url text,
  model text not null,
  embed_model text default 'Xenova/bge-small-en-v1.5',
  enc text not null,
  shared boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  uid uuid not null unique,
  org_id uuid not null,
  user_id uuid,
  action text not null,
  detail jsonb not null default '{}',
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists audit_org_idx on audit_log(org_id, id desc);
create index if not exists audit_user_time_idx on audit_log(user_id, created_at);

create table if not exists pending_answers (
  audit_uid uuid primary key,
  user_id uuid not null,
  org_id uuid not null,
  sources jsonb not null,
  canary text not null,
  redact_output boolean not null default true,
  created_at timestamptz not null default now()
);
