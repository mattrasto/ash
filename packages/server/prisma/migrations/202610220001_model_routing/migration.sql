-- Routing captures are immutable execution evidence, including interrupted attempts.
CREATE FUNCTION protect_model_routing_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type'='model_routing_request' THEN RAISE EXCEPTION 'Captured routing requests are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER model_routing_request_immutable BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_model_routing_request();
