CREATE TABLE IF NOT EXISTS vocabulary_practice_states (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  last_practiced_at INTEGER NOT NULL,
  last_decision TEXT NOT NULL,
  review_again_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_practice_states_user_updated
ON vocabulary_practice_states(user_id, updated_at DESC);
