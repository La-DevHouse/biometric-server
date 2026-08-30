-- CreateTable
CREATE TABLE "devices" (
    "dev_id" TEXT NOT NULL,
    "fk_name" TEXT,
    "firmware" TEXT,
    "fk_bin_data_lib" TEXT,
    "supported_enroll_data" TEXT,
    "last_seen_at" BIGINT,
    "created_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "stat_user_count" INTEGER,
    "stat_manager_count" INTEGER,
    "stat_fp_count" INTEGER,
    "stat_log_count" INTEGER,
    "stat_updated_at" BIGINT,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("dev_id")
);

-- CreateTable
CREATE TABLE "commands" (
    "trans_id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "cmd_code" TEXT NOT NULL,
    "cmd_param" TEXT,
    "cmd_binary" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'WAIT',
    "result_json" TEXT,
    "result_binary" BYTEA,
    "cmd_return_code" TEXT,
    "created_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "updated_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "op_id" INTEGER,

    CONSTRAINT "commands_pkey" PRIMARY KEY ("trans_id")
);

-- CreateTable
CREATE TABLE "attendance_logs" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "verify_mode" TEXT,
    "io_mode" INTEGER,
    "io_time" TEXT,
    "log_image" BYTEA,
    "received_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,

    CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT,
    "user_privilege" TEXT,
    "user_photo" BYTEA,
    "updated_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enroll_data" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "backup_number" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "updated_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,

    CONSTRAINT "enroll_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_buffer" (
    "dev_id" TEXT NOT NULL,
    "trans_id" INTEGER NOT NULL,
    "blk_no" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "received_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,

    CONSTRAINT "block_buffer_pkey" PRIMARY KEY ("dev_id","trans_id","blk_no")
);

-- CreateTable
CREATE TABLE "raw_traffic" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "dev_id" TEXT,
    "request_code" TEXT,
    "headers_json" TEXT,
    "body_preview" TEXT,
    "body_size" INTEGER,
    "binary_size" INTEGER,
    "created_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,

    CONSTRAINT "raw_traffic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dev_id" TEXT NOT NULL,
    "user_id" TEXT,
    "params_json" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "step_index" INTEGER NOT NULL DEFAULT 0,
    "step_total" INTEGER NOT NULL DEFAULT 1,
    "plan_json" TEXT,
    "current_trans_id" INTEGER,
    "last_trans_id" INTEGER,
    "result_note" TEXT,
    "error_note" TEXT,
    "created_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "updated_at" BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint,
    "finished_at" BIGINT,

    CONSTRAINT "operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commands_dev_id_status_idx" ON "commands"("dev_id", "status");

-- CreateIndex
CREATE INDEX "commands_op_id_idx" ON "commands"("op_id");

-- CreateIndex
CREATE INDEX "attendance_logs_dev_id_idx" ON "attendance_logs"("dev_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_attendance_natural" ON "attendance_logs"("dev_id", "user_id", "io_time");

-- CreateIndex
CREATE INDEX "users_dev_id_idx" ON "users"("dev_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_dev_id_user_id_key" ON "users"("dev_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enroll_data_dev_id_user_id_backup_number_key" ON "enroll_data"("dev_id", "user_id", "backup_number");

-- CreateIndex
CREATE INDEX "raw_traffic_created_at_idx" ON "raw_traffic"("created_at" DESC);

-- CreateIndex
CREATE INDEX "operations_dev_id_stage_idx" ON "operations"("dev_id", "stage");

-- CreateIndex
CREATE INDEX "operations_created_at_idx" ON "operations"("created_at" DESC);
