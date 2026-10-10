-- Existing development tables, baselined by the guarded provisioner.
CREATE TABLE dev_meta (instance_id text PRIMARY KEY, generation text NOT NULL, schema_version integer NOT NULL);
CREATE TABLE dev_scratch (id integer PRIMARY KEY CHECK (id = 1), note text NOT NULL, count integer NOT NULL DEFAULT 0);
