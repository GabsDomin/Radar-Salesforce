-- Todo dado coletado guarda fonte (url/source) e data de coleta (collected_at / fetched_at).

CREATE TABLE IF NOT EXISTS companies (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  normalized_name  TEXT NOT NULL UNIQUE,
  cnpj             TEXT,
  domain           TEXT,
  sector           TEXT,              -- industria | financeiro | agro | outro
  sector_source    TEXT,              -- 'inferido: ...' ou 'cnae: ...'
  cnae             TEXT,
  size_band        TEXT,              -- ex.: '100+', '<100', desconhecido = NULL
  size_source      TEXT,
  city             TEXT,
  state            TEXT,
  status           TEXT NOT NULL DEFAULT 'novo',   -- novo | em_analise | qualificado | em_abordagem | descartado
  stage            TEXT NOT NULL DEFAULT 'radar',  -- radar | aprovada | abordagem | respondeu | reuniao | proposta | ganha | perdida
  next_action      TEXT,
  next_action_at   TEXT,
  notes            TEXT,
  excluded_reason  TEXT,              -- cliente | concorrente | recrutadora | NULL
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_aliases (
  id               INTEGER PRIMARY KEY,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias            TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  source           TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_documents (
  id           INTEGER PRIMARY KEY,
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,
  http_status  INTEGER,
  content_hash TEXT,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signals (
  id           INTEGER PRIMARY KEY,
  company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,          -- vaga | tecnologia | gatilho
  subtype      TEXT,                   -- ex.: developer, arquiteto, marketing_cloud, fusao
  title        TEXT NOT NULL,
  evidence     TEXT,                   -- trecho que comprova o sinal
  url          TEXT NOT NULL,
  source       TEXT NOT NULL,          -- gupy | dns | site | ...
  external_id  TEXT NOT NULL,
  company_raw  TEXT,                   -- nome da empresa como veio da fonte
  published_at TEXT,
  collected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  meta         TEXT,                   -- JSON com detalhes (clouds, senioridade, classificação)
  review_flag  TEXT,                   -- motivo para revisão humana (ex.: consultoria provável)
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS exclusions (
  id              INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL,       -- cliente | concorrente | recrutadora
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  cnpj            TEXT,
  domain          TEXT,
  origin          TEXT NOT NULL,       -- arquivo/semente de onde veio
  imported_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, normalized_name)
);

CREATE TABLE IF NOT EXISTS scores (
  company_id    INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  total         INTEGER NOT NULL,
  fit           INTEGER NOT NULL,
  signal        INTEGER NOT NULL,
  offers        TEXT NOT NULL,         -- JSON: [{offer, reasons[]}]
  breakdown     TEXT NOT NULL,         -- JSON: [{rule, points, max, reason, signalIds[]}]
  rules_version TEXT NOT NULL,
  computed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contatos: só cadastro manual. Base legal e opt-out obrigatórios (LGPD).
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT,
  email       TEXT,
  origin      TEXT NOT NULL,
  legal_basis TEXT NOT NULL DEFAULT 'legitimo_interesse_b2b',
  opt_out     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id          INTEGER PRIMARY KEY,
  collector   TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  stats       TEXT,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_signals_company ON signals(company_id);
