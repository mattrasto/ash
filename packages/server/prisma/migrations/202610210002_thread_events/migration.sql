-- Remove the fixed manual-unarchive hold without changing unread protection or dispatching work.
-- A currently protected Thread must not suddenly expire from its old assessment on upgrade.
UPDATE threads SET lifecycle=lifecycle||'{"kind":"indefinite","deadline":null,"pendingAt":null}'::jsonb
WHERE NOT is_archived AND jsonb_typeof(lifecycle->'visibleUntil')='string' AND (lifecycle->>'visibleUntil')::timestamptz>clock_timestamp();
UPDATE threads SET lifecycle=(lifecycle-'visibleUntil') || CASE
 WHEN jsonb_typeof(lifecycle->'undo')='object' THEN jsonb_build_object('undo',(lifecycle->'undo')-'visibleUntil') ELSE '{}'::jsonb END;

CREATE OR REPLACE FUNCTION record_thread_activity(t uuid, source uuid, unseen boolean, message_count integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb; n integer; stamp text; archived boolean; event_time timestamptz;
BEGIN
 SELECT lifecycle,is_archived INTO v,archived FROM threads WHERE id=t FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 n=COALESCE((v->>'activity')::integer,0)+1;
 event_time=clock_timestamp();
 stamp=to_char(event_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 UPDATE threads SET is_archived=false,updated_at=event_time,lifecycle=v||jsonb_build_object(
  'activity',n,'version',COALESCE((v->>'version')::integer,0)+1,'sourceId',source,
  'messages',COALESCE((v->>'messages')::integer,0)+message_count,
  'kind','pending','deadline',NULL,'origin',NULL,'undo',NULL,
  'pendingAt',COALESCE(v->>'pendingAt',stamp),'changedAt',stamp,
  'unread',CASE WHEN unseen THEN n ELSE COALESCE((v->>'unread')::integer,0) END,
  'unreadAt',CASE WHEN unseen THEN stamp ELSE v->>'unreadAt' END
 ) WHERE id=t;
 IF archived THEN
  INSERT INTO artifacts(id,thread_id,source_id,layer,actor,payload,created_at,updated_at)
  VALUES(gen_random_uuid(),t,source,'surface','system','{"type":"thread_event","event":"unarchived","origin":"activity"}',event_time,event_time);
 END IF;
END; $$;

CREATE FUNCTION protect_thread_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type' IN ('thread_control','thread_event') THEN RAISE EXCEPTION 'Thread history artifacts are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER thread_event_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_thread_event();

-- Upgrade only the previous shipped default; retain user-edited guidance.
UPDATE instructions SET text='Keep a Thread visible while its matter remains useful. Give completed one-off matters an appropriate finite lifetime. Use exact event dates and the supplied current time/time zone when supported by evidence. Keep ongoing or uncertain matters visible indefinitely. Never invent a deadline. An immediate result is suitable only when the matter has no remaining usefulness. Consider recent manual activity, especially unarchiving, as evidence of renewed interest; choose a suitable lifetime from the context rather than a fixed grace period. Pinning and unread protection are enforced separately.',updated_at=clock_timestamp()
WHERE key='thread-visibility' AND text='Keep a Thread visible while its matter remains useful. Give completed one-off matters an appropriate finite lifetime. Use exact event dates and the supplied current time/time zone when supported by evidence. Keep ongoing or uncertain matters visible indefinitely. Never invent a deadline. An immediate result is suitable only when the matter has no remaining usefulness. Pinning, unread and manual unarchive protection are enforced separately.';
