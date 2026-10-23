ALTER TABLE threads ADD COLUMN interaction_mode text NOT NULL DEFAULT 'chat' CHECK(interaction_mode IN ('chat','adapt'));
CREATE TABLE adapt_workspaces (
 id uuid PRIMARY KEY,
 thread_id uuid NOT NULL UNIQUE REFERENCES threads(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 base_revision text NOT NULL CHECK(base_revision ~ '^[a-f0-9]{40,64}$'),
 status text NOT NULL DEFAULT 'preparing',
 controller jsonb NOT NULL DEFAULT '{}',
 checkpoint jsonb,
 created_at timestamptz(6) NOT NULL,
 updated_at timestamptz(6) NOT NULL
);
CREATE TABLE adapt_executions (
 run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 workspace_id uuid NOT NULL REFERENCES adapt_workspaces(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 controller jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX adapt_executions_workspace_id_idx ON adapt_executions(workspace_id);
CREATE FUNCTION protect_coding_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type' IN ('coding_request','coding_evidence') THEN RAISE EXCEPTION 'Coding captures are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER coding_capture_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_coding_capture();
