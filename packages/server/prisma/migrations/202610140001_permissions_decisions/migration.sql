CREATE TABLE permissions (
 id uuid PRIMARY KEY, category text NOT NULL CHECK(category IN ('filesystem','computer_use','interaction','self_modification')),
 effect text NOT NULL CHECK(effect IN ('allow','ask','deny')), policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 created_at timestamptz(6) NOT NULL, updated_at timestamptz(6) NOT NULL, deleted_at timestamptz(6)
);
CREATE INDEX permissions_category_deleted_at_idx ON permissions(category,deleted_at);
CREATE TABLE decisions (
 id uuid PRIMARY KEY, thread_id uuid REFERENCES threads(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 source_artifact_id uuid REFERENCES artifacts(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','snoozed','resolved','cancelled')),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'), resolution jsonb,
 snoozed_until timestamptz(6), due_at timestamptz(6), created_at timestamptz(6) NOT NULL, updated_at timestamptz(6) NOT NULL,
 CHECK((status='snoozed' AND snoozed_until IS NOT NULL) OR (status<>'snoozed' AND snoozed_until IS NULL)),
 CHECK((status IN ('pending','snoozed') AND resolution IS NULL) OR (status IN ('resolved','cancelled') AND resolution IS NOT NULL)),
 CHECK(resolution IS NULL OR jsonb_typeof(resolution)='object')
);
CREATE INDEX decisions_status_created_at_id_idx ON decisions(status,created_at,id);
CREATE INDEX decisions_status_snoozed_until_idx ON decisions(status,snoozed_until);
CREATE INDEX decisions_status_due_at_idx ON decisions(status,due_at);
CREATE INDEX decisions_thread_id_idx ON decisions(thread_id);
CREATE INDEX decisions_source_artifact_id_idx ON decisions(source_artifact_id);
CREATE FUNCTION protect_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.request<>OLD.request OR NEW.thread_id IS DISTINCT FROM OLD.thread_id OR NEW.source_artifact_id IS DISTINCT FROM OLD.source_artifact_id OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Reviewed Decision requests are immutable'; END IF;
 IF OLD.status IN ('resolved','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Decision resolutions are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER decisions_immutable BEFORE UPDATE ON decisions FOR EACH ROW EXECUTE FUNCTION protect_decision();
CREATE FUNCTION protect_permission_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.category<>OLD.category OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Permission identity and category are fixed'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER permissions_category_fixed BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION protect_permission_category();
ALTER TABLE runs DROP CONSTRAINT runs_status_check, DROP CONSTRAINT runs_ended_check, DROP CONSTRAINT runs_started_check;
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK(status IN ('queued','running','waiting','completed','failed','cancelled','interrupted'));
ALTER TABLE runs ADD CONSTRAINT runs_ended_check CHECK((status IN ('queued','running','waiting') AND ended_at IS NULL) OR (status IN ('completed','failed','cancelled','interrupted') AND ended_at IS NOT NULL));
ALTER TABLE runs ADD CONSTRAINT runs_started_check CHECK(status NOT IN ('running','waiting','completed') OR started_at IS NOT NULL);
CREATE OR REPLACE FUNCTION protect_captured_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type' IN ('model_request','model_output','tool_call','tool_result','permission_evaluation') AND (TG_OP='UPDATE' OR OLD.thread_id IS NOT NULL) THEN RAISE EXCEPTION 'Captured execution artifacts are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
