-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "instruction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instruction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_topics" (
    "thread_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "thread_topics_pkey" PRIMARY KEY ("thread_id","topic_id")
);

-- CreateTable
CREATE TABLE "instructions" (
    "id" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" UUID NOT NULL,
    "layer" TEXT NOT NULL,
    "source_id" UUID,
    "thread_id" UUID,
    "run_id" UUID,
    "actor" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "input_artifact_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "retry_of_id" UUID,
    "status" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "error" JSONB,
    "request_key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topics_instruction_id_key" ON "topics"("instruction_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_instruction_id_key" ON "threads"("instruction_id");

-- CreateIndex
CREATE INDEX "thread_topics_topic_id_idx" ON "thread_topics"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "instructions_key_key" ON "instructions"("key");

-- CreateIndex
CREATE INDEX "artifacts_source_id_idx" ON "artifacts"("source_id");

-- CreateIndex
CREATE INDEX "artifacts_run_id_idx" ON "artifacts"("run_id");

-- CreateIndex
CREATE INDEX "artifacts_thread_id_created_at_id_idx" ON "artifacts"("thread_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "runs_request_key_key" ON "runs"("request_key");

-- CreateIndex
CREATE INDEX "runs_input_artifact_id_idx" ON "runs"("input_artifact_id");

-- CreateIndex
CREATE INDEX "runs_thread_id_idx" ON "runs"("thread_id");

-- CreateIndex
CREATE INDEX "runs_retry_of_id_idx" ON "runs"("retry_of_id");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "instructions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_instruction_id_fkey" FOREIGN KEY ("instruction_id") REFERENCES "instructions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread_topics" ADD CONSTRAINT "thread_topics_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "thread_topics" ADD CONSTRAINT "thread_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_input_artifact_id_fkey" FOREIGN KEY ("input_artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_id_fkey" FOREIGN KEY ("retry_of_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- SQL-only invariants; Prisma does not represent these checks/partial indexes.
ALTER TABLE artifacts ADD CONSTRAINT artifacts_layer_check CHECK (layer IN ('input','filter','route','act','surface'));
ALTER TABLE artifacts ADD CONSTRAINT artifacts_actor_check CHECK (actor IN ('user','ash','system'));
ALTER TABLE artifacts ADD CONSTRAINT artifacts_source_check CHECK ((layer = 'input' AND source_id IS NULL) OR (layer <> 'input' AND source_id IS NOT NULL));
ALTER TABLE artifacts ADD CONSTRAINT artifacts_not_self_check CHECK (source_id IS NULL OR source_id <> id);
ALTER TABLE artifacts ADD CONSTRAINT artifacts_surface_owner_check CHECK (layer <> 'surface' OR thread_id IS NOT NULL);
ALTER TABLE runs ADD CONSTRAINT runs_status_check CHECK (status IN ('queued','running','completed','failed','cancelled','interrupted'));
ALTER TABLE runs ADD CONSTRAINT runs_retry_check CHECK (retry_of_id IS NULL OR retry_of_id <> id);
ALTER TABLE runs ADD CONSTRAINT runs_ended_check CHECK ((status IN ('queued','running') AND ended_at IS NULL) OR (status IN ('completed','failed','cancelled','interrupted') AND ended_at IS NOT NULL));
ALTER TABLE runs ADD CONSTRAINT runs_started_check CHECK (status NOT IN ('running','completed') OR started_at IS NOT NULL);
ALTER TABLE runs ADD CONSTRAINT runs_state_check CHECK (jsonb_typeof(state) = 'object');
ALTER TABLE runs ADD CONSTRAINT runs_error_check CHECK (error IS NULL OR jsonb_typeof(error) = 'object');
CREATE UNIQUE INDEX one_active_run_per_thread ON runs (thread_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX one_initial_run_per_input ON runs (input_artifact_id) WHERE retry_of_id IS NULL;
