-- Image descriptions run independently of a conversation's active-response slot.
ALTER TABLE runs ALTER COLUMN thread_id DROP NOT NULL;
CREATE TABLE attachments (
  id uuid PRIMARY KEY, filename text NOT NULL,
  input_artifact_id uuid NOT NULL UNIQUE REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  summary_run_id uuid UNIQUE REFERENCES runs(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  summary text, metadata jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL, expires_at timestamptz(6),
  CONSTRAINT attachment_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX attachments_expires_at_idx ON attachments(expires_at);
CREATE TABLE artifact_attachments (
  artifact_id uuid NOT NULL REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  PRIMARY KEY (artifact_id, attachment_id)
);
CREATE INDEX artifact_attachments_attachment_id_idx ON artifact_attachments(attachment_id);
