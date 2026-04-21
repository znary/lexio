CREATE TABLE IF NOT EXISTS vocabulary_item_context_sentences (
  vocabulary_item_id TEXT NOT NULL,
  sentence TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (vocabulary_item_id, sentence),
  FOREIGN KEY (vocabulary_item_id) REFERENCES vocabulary_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_context_sentences_item_last_seen
  ON vocabulary_item_context_sentences(vocabulary_item_id, last_seen_at DESC);

INSERT INTO vocabulary_item_context_sentences (
  vocabulary_item_id,
  sentence,
  created_at,
  last_seen_at
)
SELECT
  id,
  context_sentence,
  updated_at,
  updated_at
FROM vocabulary_items
WHERE context_sentence IS NOT NULL
  AND TRIM(context_sentence) != ''
ON CONFLICT(vocabulary_item_id, sentence) DO NOTHING;
