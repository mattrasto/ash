CREATE TABLE "scene_bundles" (
  "id" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "manifest_text" TEXT NOT NULL,
  "manifest_hash" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "scene_bundles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scene_bundles_manifest_object" CHECK (jsonb_typeof(manifest) = 'object'),
  CONSTRAINT "scene_bundles_hash" CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "scene_bundles_size" CHECK (size_bytes > 0)
);
CREATE TABLE "scene_state" (
  "id" TEXT NOT NULL,
  "active_bundle_id" TEXT,
  "previous_bundle_id" TEXT,
  "location" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "scene_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scene_state_revision" CHECK (revision >= 0),
  CONSTRAINT "scene_state_location" CHECK (location IS NULL OR jsonb_typeof(location) = 'object'),
  CONSTRAINT "scene_state_active_bundle_id_fkey" FOREIGN KEY ("active_bundle_id") REFERENCES "scene_bundles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "scene_state_previous_bundle_id_fkey" FOREIGN KEY ("previous_bundle_id") REFERENCES "scene_bundles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE FUNCTION protect_scene_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Scene bundles are immutable';
END;
$$;
CREATE TRIGGER scene_bundle_immutable BEFORE UPDATE ON scene_bundles
FOR EACH ROW EXECUTE FUNCTION protect_scene_bundle();
