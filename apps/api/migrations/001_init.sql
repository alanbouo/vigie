-- Vigie — schéma initial (§7 de la spec)
create extension if not exists pgcrypto;

-- Agences (white-label : logo, couleurs) et utilisateurs.
create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  api_key text not null unique default encode(gen_random_bytes(24), 'hex'),
  logo_url text,
  couleur_primaire text,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Sites surveillés. plafond_pages appliqué dans le code (§9).
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  url text not null,
  palier text not null default 'starter',
  plafond_pages int not null default 500,
  key_pages jsonb not null default '[]',
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agency_id, url)
);

create table if not exists crawls (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  type text not null check (type in ('hebdo', 'quotidien')),
  statut text not null default 'en_cours'
    check (statut in ('en_cours', 'termine', 'erreur')),
  stats jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists crawls_site_idx on crawls (site_id, type, started_at desc);

-- Snapshot par page (§3.2) — champs dans data (jsonb).
create table if not exists page_snapshots (
  id bigserial primary key,
  crawl_id uuid not null references crawls(id) on delete cascade,
  url text not null,
  content_hash text,
  data jsonb not null
);
create index if not exists page_snapshots_crawl_idx on page_snapshots (crawl_id);

-- Snapshot au niveau site : robots + crawlers IA, llms.txt, sitemap, SSL, CWV.
create table if not exists site_snapshots (
  crawl_id uuid primary key references crawls(id) on delete cascade,
  data jsonb not null
);

-- Événements de changement émis par le moteur de diff (§3.3),
-- avec l'état de confirmation sur 2 crawls (§3.5).
create table if not exists change_events (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  crawl_id uuid references crawls(id) on delete set null,
  signal text not null,
  cause_key text not null,
  severite text not null,
  pages jsonb not null,
  explication text not null,
  correctif text not null,
  detecte_le timestamptz not null default now(),
  confirme boolean not null default false,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'confirme', 'disparu'))
);
create index if not exists change_events_site_idx on change_events (site_id, statut);

-- Findings unifiés (§5) — les 3 moteurs écrivent ici.
create table if not exists findings (
  finding_id uuid primary key,
  site_id uuid not null references sites(id) on delete cascade,
  source text not null check (source in ('garde', 'diagnostic', 'visibilite_ia')),
  pilier text not null check (pilier in ('seo', 'geo', 'visibilite')),
  signal text not null,
  severite text not null check (severite in ('critique', 'important', 'info')),
  pages jsonb not null,
  explication text not null,
  correctif text not null,
  effort int not null check (effort between 1 and 5),
  detecte_le timestamptz not null,
  confirme boolean not null,
  statut text not null default 'ouvert'
    check (statut in ('ouvert', 'corrige', 'acquitte')),
  cause_key text,
  alerte_envoyee_le timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists findings_site_idx on findings (site_id, statut);

-- Log de calibrage du scoring (§6.3) : chaque score calculé est journalisé.
create table if not exists scores (
  id bigserial primary key,
  finding_id uuid not null references findings(finding_id) on delete cascade,
  valeur numeric not null,
  facteurs jsonb not null,
  calcule_le timestamptz not null default now()
);

create table if not exists diagnostics (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id) on delete cascade,
  agency_id uuid references agencies(id) on delete cascade,
  url text not null,
  profondeur text not null check (profondeur in ('quick', 'full')),
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'en_cours', 'termine', 'erreur')),
  cout jsonb,
  artefacts jsonb,
  offert boolean not null default false,
  erreur text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists diagnostics_statut_idx on diagnostics (statut, created_at);

-- Rapport hebdo par site : Top 3 ou « ✅ RAS ».
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  semaine date not null,
  ras boolean not null,
  top3 jsonb not null,
  envoye_le timestamptz,
  unique (site_id, semaine)
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  stripe_subscription_id text unique,
  palier text not null,
  statut text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Crédits Diagnostic : livre de compte (delta +/-).
create table if not exists credits (
  id bigserial primary key,
  agency_id uuid not null references agencies(id) on delete cascade,
  delta int not null,
  motif text not null,
  stripe_event_id text unique,
  created_at timestamptz not null default now()
);

-- Instrumentation des coûts dès J1 (§10).
create table if not exists cost_log (
  id bigserial primary key,
  scope text not null check (scope in ('crawl', 'diagnostic', 'visibilite')),
  ref_id uuid,
  site_id uuid,
  cout_usd numeric,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ── v1.5 : Visibilité IA (§8) — tables préparées, module hors MVP ──
create table if not exists prompt_baskets (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  prompts jsonb not null,
  concurrents jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists visibility_runs (
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references prompt_baskets(id) on delete cascade,
  moteur text not null,
  prompt text not null,
  run_idx int not null,
  semaine date not null,
  reponse_brute_ref text,
  created_at timestamptz not null default now()
);

create table if not exists visibility_extractions (
  run_id uuid primary key references visibility_runs(id) on delete cascade,
  brand_mentioned boolean not null,
  position int,
  sentiment text,
  citations jsonb not null default '[]',
  competitors jsonb not null default '[]'
);
