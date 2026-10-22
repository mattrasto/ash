BEGIN;
-- Waiting frees the execution slot, but is not a settled response. Keep the already
-- deployed visibility migrations intact for previews upgrading in either order.
CREATE OR REPLACE FUNCTION thread_run_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE visible boolean; messages integer;
BEGIN
 IF NEW.thread_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM record_thread_activity(NEW.thread_id,NEW.input_artifact_id,false,0);
 ELSIF OLD.status IN ('queued','running','waiting') AND NEW.status IN ('completed','failed','cancelled','interrupted') THEN
  SELECT NOT EXISTS(SELECT 1 FROM artifacts WHERE run_id=NEW.id AND payload->'incoming'->>'showResponse'='false') INTO visible;
  SELECT count(*) INTO messages FROM artifacts WHERE run_id=NEW.id AND layer='surface';
  PERFORM record_thread_activity(NEW.thread_id,NEW.input_artifact_id,visible,messages);
 END IF;
 RETURN NEW;
END; $$;
-- The original backfill considered waiting terminal. Recount saved Surface identities
-- without touching visibility, title ownership, captures, read state or pending work.
WITH counts AS (
 SELECT t.id,(SELECT count(*)::integer FROM artifacts a LEFT JOIN runs r ON r.id=a.run_id
  WHERE a.thread_id=t.id AND a.layer='surface' AND
   (a.payload->>'speaker' IN ('user','source') OR r.status IN ('completed','failed','cancelled','interrupted'))) AS messages
 FROM threads t
)
UPDATE threads t SET lifecycle=t.lifecycle||jsonb_build_object('messages',c.messages,
 'namedCount',LEAST(COALESCE((t.lifecycle->>'namedCount')::integer,0),c.messages))
FROM counts c WHERE c.id=t.id AND COALESCE((t.lifecycle->>'messages')::integer,0)<>c.messages;
COMMIT;
