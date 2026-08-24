-- Add database-level duplicate protection for main component numbers.
-- Existing rows are normalized the same way as the Worker: leading zeroes are ignored.

ALTER TABLE records ADD COLUMN hovedkomponentnr_normalized TEXT;

UPDATE records
SET hovedkomponentnr_normalized = CAST(CAST(hovedkomponentnr AS INTEGER) AS TEXT)
WHERE TRIM(COALESCE(hovedkomponentnr, '')) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_records_hoved_normalized_unique
ON records(hovedkomponentnr_normalized)
WHERE hovedkomponentnr_normalized IS NOT NULL
  AND hovedkomponentnr_normalized <> '';
