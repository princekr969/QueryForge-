-- QueryForge PostgreSQL Schema
-- Loaded automatically by postgres Docker image on first run

-- ── Datasets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datasets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255)  NOT NULL,
  original_filename VARCHAR(255),
  minio_path       VARCHAR(500),
  schema_json      JSONB,          -- { "columns": [{ "name": "...", "type": "..." }] }
  row_count        INTEGER,
  partition_count  INTEGER DEFAULT 3,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- ── Partitions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id      UUID REFERENCES datasets(id) ON DELETE CASCADE,
  partition_index INTEGER NOT NULL,
  minio_path      VARCHAR(500) NOT NULL,
  row_count       INTEGER,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── Workers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
  id             VARCHAR(100) PRIMARY KEY,   -- e.g. "worker-1"
  address        VARCHAR(255) NOT NULL,
  port           INTEGER      NOT NULL,
  status         VARCHAR(50)  DEFAULT 'active',  -- active | dead
  last_heartbeat TIMESTAMP,
  registered_at  TIMESTAMP DEFAULT NOW()
);

-- ── Jobs ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sql_query        TEXT    NOT NULL,
  dataset_id       UUID REFERENCES datasets(id),
  status           VARCHAR(50) DEFAULT 'pending',  -- pending | running | completed | failed
  result_row_count INTEGER,
  execution_time_ms INTEGER,
  created_at       TIMESTAMP DEFAULT NOW(),
  completed_at     TIMESTAMP
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id      VARCHAR(100) REFERENCES workers(id),
  partition_id   UUID REFERENCES partitions(id),
  status         VARCHAR(50) DEFAULT 'pending',  -- pending | running | completed | failed | reassigned
  started_at     TIMESTAMP,
  completed_at   TIMESTAMP,
  rows_processed INTEGER,
  error_message  TEXT
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_partitions_dataset_id ON partitions(dataset_id);
CREATE INDEX IF NOT EXISTS idx_tasks_job_id          ON tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status           ON jobs(status);
