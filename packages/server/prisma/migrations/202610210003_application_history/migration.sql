BEGIN;
-- Preserve existing captures and notices before removing the feature's Artifact records.
LOCK TABLE artifacts, thread_assessments, threads IN ACCESS EXCLUSIVE MODE;
ALTER TABLE thread_assessments ADD COLUMN request jsonb, ADD COLUMN result jsonb;
UPDATE thread_assessments a SET request=r.payload FROM artifacts r WHERE r.id=a.id;
UPDATE thread_assessments a SET result=r.payload FROM artifacts r WHERE r.source_id=a.id AND r.payload->>'type'='thread_assessment_result';
ALTER TABLE thread_assessments ALTER COLUMN request SET NOT NULL;
ALTER TABLE thread_assessments DROP CONSTRAINT thread_assessments_id_fkey;
CREATE TABLE application_changes (
 id uuid PRIMARY KEY,
 thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 origin text NOT NULL CHECK(origin IN ('manual','automatic','activity','undo')),
 command jsonb,
 events jsonb NOT NULL CHECK(jsonb_typeof(events)='array'),
 source_artifact_id uuid REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 assessment_id uuid REFERENCES thread_assessments(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 created_at timestamptz(6) NOT NULL
);
CREATE INDEX application_changes_thread_id_created_at_id_idx ON application_changes(thread_id,created_at,id);
CREATE INDEX application_changes_source_artifact_id_idx ON application_changes(source_artifact_id);
CREATE INDEX application_changes_assessment_id_idx ON application_changes(assessment_id);
INSERT INTO application_changes(id,thread_id,origin,command,events,created_at)
 SELECT a.id,a.thread_id,CASE WHEN a.payload->'command'->>'undo'='true' THEN 'undo' ELSE 'manual' END,a.payload->'command',
 '[]',a.created_at
 FROM artifacts a WHERE a.payload->>'type'='thread_control';
INSERT INTO application_changes(id,thread_id,origin,command,events,source_artifact_id,assessment_id,created_at)
 SELECT a.id,a.thread_id,a.payload->>'origin',CASE WHEN parent.payload->>'type'='thread_control' THEN parent.payload->'command' ELSE NULL END,jsonb_build_array(a.payload),
 CASE WHEN parent.payload->>'type' IN ('thread_assessment_result','thread_control') THEN NULL ELSE a.source_id END,
 CASE WHEN parent.payload->>'type'='thread_assessment_result' THEN parent.source_id ELSE NULL END,a.created_at
 FROM artifacts a JOIN artifacts parent ON parent.id=a.source_id
 WHERE a.payload->>'type'='thread_event';
UPDATE threads t SET lifecycle=t.lifecycle||jsonb_build_object('sourceId',NULL,'changeId',t.lifecycle->'sourceId')
 WHERE EXISTS(SELECT 1 FROM application_changes c WHERE c.id::text=t.lifecycle->>'sourceId');
UPDATE thread_assessments a SET capture=a.capture||jsonb_build_object('sourceId',NULL,'changeId',a.capture->'sourceId')
 WHERE EXISTS(SELECT 1 FROM application_changes c WHERE c.id::text=a.capture->>'sourceId');
-- Captured requests remain byte-for-byte historical evidence, including their old selection IDs.
CREATE TEMP TABLE moved_thread_artifacts ON COMMIT DROP AS SELECT id FROM artifacts
 WHERE payload->>'type' IN ('thread_control','thread_event','thread_assessment_result')
 OR payload->>'purpose' IN ('thread_visibility','thread_naming');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM artifacts a JOIN moved_thread_artifacts p ON p.id=a.source_id WHERE a.id NOT IN(SELECT id FROM moved_thread_artifacts)) THEN
  RAISE EXCEPTION 'Unexpected non-visibility descendant; preserve Artifact history and review migration';
 END IF;
END; $$;
DROP TRIGGER thread_event_immutable ON artifacts;
DROP FUNCTION protect_thread_event();
DROP TRIGGER thread_assessment_immutable ON artifacts;
DROP FUNCTION protect_thread_assessment();
ALTER TABLE artifacts DISABLE TRIGGER captured_artifacts_immutable;
-- Delete leaves before roots because causal links use RESTRICT.
DELETE FROM artifacts WHERE id IN(SELECT id FROM moved_thread_artifacts) AND payload->>'type'='thread_event';
DELETE FROM artifacts WHERE id IN(SELECT id FROM moved_thread_artifacts) AND payload->>'type'='thread_assessment_result';
DELETE FROM artifacts WHERE id IN(SELECT id FROM moved_thread_artifacts) AND payload->>'type'='model_request';
DELETE FROM artifacts WHERE id IN(SELECT id FROM moved_thread_artifacts);
ALTER TABLE artifacts ENABLE TRIGGER captured_artifacts_immutable;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_exclude_thread_management CHECK (
 COALESCE(payload->>'type','') NOT IN ('thread_control','thread_event','thread_assessment_result') AND
 COALESCE(payload->>'purpose','') NOT IN ('thread_visibility','thread_naming')
);
CREATE FUNCTION protect_application_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Application history is immutable'; END; $$;
CREATE TRIGGER application_changes_immutable BEFORE UPDATE OR DELETE ON application_changes FOR EACH ROW EXECUTE FUNCTION protect_application_change();
CREATE FUNCTION protect_assessment_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'running' THEN RAISE EXCEPTION 'Settled assessments are immutable'; END IF;
 IF (NEW.id,NEW.thread_id,NEW.kind,NEW.capture,NEW.request,NEW.created_at) IS DISTINCT FROM
    (OLD.id,OLD.thread_id,OLD.kind,OLD.capture,OLD.request,OLD.created_at) THEN RAISE EXCEPTION 'Assessment captures are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER assessment_capture_immutable BEFORE UPDATE OR DELETE ON thread_assessments FOR EACH ROW EXECUTE FUNCTION protect_assessment_capture();
ALTER TABLE thread_assessments ADD CONSTRAINT assessment_outcome CHECK (
 (status='running' AND result IS NULL AND finished_at IS NULL) OR
 (status<>'running' AND result IS NOT NULL AND finished_at IS NOT NULL AND COALESCE(result->>'status','')=status AND COALESCE(result->>'kind','')=kind)
);
CREATE OR REPLACE FUNCTION record_thread_activity(t uuid, source uuid, unseen boolean, message_count integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb; n integer; stamp text; archived boolean; event_time timestamptz;
BEGIN
 SELECT lifecycle,is_archived INTO v,archived FROM threads WHERE id=t FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 n=COALESCE((v->>'activity')::integer,0)+1;
 event_time=clock_timestamp();
 stamp=to_char(event_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE threads SET is_archived=false,updated_at=event_time,lifecycle=v||jsonb_build_object(
  'activity',n,'version',COALESCE((v->>'version')::integer,0)+1,'sourceId',source,'changeId',NULL,
  'messages',COALESCE((v->>'messages')::integer,0)+message_count,
  'kind','pending','deadline',NULL,'origin',NULL,'undo',NULL,
  'pendingAt',COALESCE(v->>'pendingAt',stamp),'changedAt',stamp,
  'unread',CASE WHEN unseen THEN n ELSE COALESCE((v->>'unread')::integer,0) END,
  'unreadAt',CASE WHEN unseen THEN stamp ELSE v->>'unreadAt' END
 ) WHERE id=t;
 IF archived THEN
  INSERT INTO application_changes(id,thread_id,origin,events,source_artifact_id,created_at)
  VALUES(gen_random_uuid(),t,'activity','[{"type":"thread_event","event":"unarchived","origin":"activity"}]',source,event_time);
 END IF;
END; $$;
COMMIT;
