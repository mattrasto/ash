-- Membership compare-and-swap survives unlink/relink cycles without changing activity time.
ALTER TABLE threads ADD COLUMN topics_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD CONSTRAINT threads_topics_version_check CHECK (topics_version >= 0);
