CREATE TABLE IF NOT EXISTS translation_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_request_key TEXT NOT NULL UNIQUE,
  scene TEXT,
  lane TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_tab_id INTEGER,
  text TEXT NOT NULL,
  source_language TEXT,
  target_language TEXT,
  system_prompt TEXT NOT NULL,
  prompt TEXT NOT NULL,
  temperature REAL,
  is_batch INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  result_text TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  canceled_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_translation_tasks_user_id ON translation_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_translation_tasks_status ON translation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_translation_tasks_owner_tab_id ON translation_tasks(owner_tab_id);
