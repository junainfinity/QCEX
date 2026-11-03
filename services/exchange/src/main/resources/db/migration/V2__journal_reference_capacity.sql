-- A fill references two UUID orders plus its type prefix (78 characters).
-- Preserve readable audit references instead of truncating their identity.
ALTER TABLE journal MODIFY reference_id VARCHAR(128) NOT NULL;
