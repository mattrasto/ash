CREATE OR REPLACE FUNCTION protect_coding_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'type' IN ('coding_request','coding_evidence','adapt_preparation','adapt_candidate','adapt_application') THEN RAISE EXCEPTION 'Coding and application captures are immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
