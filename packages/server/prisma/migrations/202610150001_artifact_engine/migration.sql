CREATE TABLE incoming_items (
 id uuid PRIMARY KEY REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 source_key text NOT NULL UNIQUE,
 request_hash text NOT NULL,
 status text NOT NULL CHECK (status IN ('queued','processing','waiting_capacity','completed','dropped','failed','interrupted')),
 state jsonb NOT NULL CHECK (jsonb_typeof(state)='object'),
 error text,
 created_at timestamptz(6) NOT NULL,
 updated_at timestamptz(6) NOT NULL
);
CREATE INDEX incoming_items_status_created_at_idx ON incoming_items(status,created_at);
CREATE FUNCTION protect_engine_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type' IN ('incoming_input','engine_request','engine_response','filter_result','route_result','act_plan','engine_error') THEN
  RAISE EXCEPTION 'Captured engine artifacts are immutable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER engine_artifacts_immutable BEFORE UPDATE OR DELETE ON artifacts
FOR EACH ROW EXECUTE FUNCTION protect_engine_artifact();
