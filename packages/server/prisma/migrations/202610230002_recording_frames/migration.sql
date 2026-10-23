-- Frame preparation may retry; source identity and capture origin never change.
CREATE FUNCTION protect_attachment_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.metadata->>'transform' IS DISTINCT FROM 'video-playback-v1' OR (NEW.metadata - 'frames' - 'frameError') IS DISTINCT FROM (OLD.metadata - 'frames' - 'frameError') THEN
  RAISE EXCEPTION 'Attachment source and capture origin are immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER attachment_source_immutable BEFORE UPDATE OF metadata ON attachments
 FOR EACH ROW EXECUTE FUNCTION protect_attachment_source();
