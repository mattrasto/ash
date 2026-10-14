CREATE TABLE provider_continuations (
  output_artifact_id uuid PRIMARY KEY REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  created_at timestamptz(6) NOT NULL
);
CREATE INDEX provider_continuations_run_id_idx ON provider_continuations(run_id);

-- Captured requests, complete calls, outputs and results are immutable even to runtime SQL.
CREATE FUNCTION protect_captured_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.payload->>'type' IN ('model_request','model_output','tool_call','tool_result') AND (TG_OP = 'UPDATE' OR OLD.thread_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Captured execution artifacts are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER captured_artifacts_immutable BEFORE UPDATE OR DELETE ON artifacts
FOR EACH ROW EXECUTE FUNCTION protect_captured_artifact();
