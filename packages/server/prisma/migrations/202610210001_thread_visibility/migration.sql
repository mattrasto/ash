ALTER TABLE threads ADD COLUMN initial_title text, ADD COLUMN lifecycle jsonb NOT NULL DEFAULT '{}';
-- Backfill visible settled message counts without scheduling inference; old titles remain manual.
UPDATE threads t SET lifecycle=jsonb_build_object('messages',(SELECT count(*) FROM artifacts a LEFT JOIN runs r ON r.id=a.run_id WHERE a.thread_id=t.id AND a.layer='surface' AND (a.payload->>'speaker' IN ('user','source') OR r.status NOT IN ('queued','running'))));
CREATE TABLE thread_assessments (
 id uuid PRIMARY KEY REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 kind text NOT NULL CHECK(kind IN ('visibility','naming')),
 status text NOT NULL CHECK(status IN ('running','applied','discarded','failed','interrupted')),
 capture jsonb NOT NULL,
 created_at timestamptz(6) NOT NULL, finished_at timestamptz(6)
);
CREATE INDEX thread_assessments_thread_id_created_at_idx ON thread_assessments(thread_id,created_at);
CREATE UNIQUE INDEX thread_assessments_active_idx ON thread_assessments(thread_id,kind) WHERE status='running';
-- Called inside the operation's transaction. All metadata writers take the Thread row lock;
-- these hooks never lock an existing Run or intake row after taking that lock.
CREATE FUNCTION record_thread_activity(t uuid, source uuid, unseen boolean, message_count integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb; n integer; stamp text;
BEGIN
 SELECT lifecycle INTO v FROM threads WHERE id=t FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 n=COALESCE((v->>'activity')::integer,0)+1;
 stamp=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE threads SET is_archived=false,updated_at=clock_timestamp(),lifecycle=v||jsonb_build_object(
  'activity',n,'version',COALESCE((v->>'version')::integer,0)+1,'sourceId',source,
  'messages',COALESCE((v->>'messages')::integer,0)+message_count,
  'kind','pending','deadline',NULL,'origin',NULL,'undo',NULL,
  'pendingAt',COALESCE(v->>'pendingAt',stamp),'changedAt',stamp,
  'unread',CASE WHEN unseen THEN n ELSE COALESCE((v->>'unread')::integer,0) END,
  'unreadAt',CASE WHEN unseen THEN stamp ELSE v->>'unreadAt' END
 ) WHERE id=t;
END; $$;
CREATE FUNCTION thread_artifact_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.thread_id IS NOT NULL THEN
  IF NEW.layer='surface' AND NEW.payload->>'speaker' IN ('user','source') THEN
   PERFORM record_thread_activity(NEW.thread_id,NEW.id,NEW.payload->>'speaker'='source',1);
  ELSIF NEW.payload->>'type' IN ('tool_result','route_result') THEN
   PERFORM record_thread_activity(NEW.thread_id,NEW.id,false,0);
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER thread_artifact_activity AFTER INSERT ON artifacts FOR EACH ROW EXECUTE FUNCTION thread_artifact_activity();
CREATE FUNCTION thread_run_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visible boolean; messages integer;
BEGIN
 IF NEW.thread_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM record_thread_activity(NEW.thread_id,NEW.input_artifact_id,false,0);
 ELSIF OLD.status IN ('queued','running') AND NEW.status NOT IN ('queued','running') THEN
  SELECT NOT EXISTS(SELECT 1 FROM artifacts WHERE run_id=NEW.id AND payload->'incoming'->>'showResponse'='false') INTO visible;
  SELECT count(*) INTO messages FROM artifacts WHERE run_id=NEW.id AND layer='surface';
  PERFORM record_thread_activity(NEW.thread_id,NEW.input_artifact_id,visible,messages);
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER thread_run_activity AFTER INSERT OR UPDATE OF status ON runs FOR EACH ROW EXECUTE FUNCTION thread_run_activity();
CREATE FUNCTION protect_thread_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type'='thread_assessment_result' OR OLD.payload->>'purpose' IN ('thread_visibility','thread_naming') THEN RAISE EXCEPTION 'Captured Thread assessments are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER thread_assessment_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_thread_assessment();
