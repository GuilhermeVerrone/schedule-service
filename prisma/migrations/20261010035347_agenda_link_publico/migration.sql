-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('confirmed', 'canceled', 'completed');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "buffer_minutes" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "cancel_deadline_minutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "max_window_days" SMALLINT NOT NULL DEFAULT 60,
ADD COLUMN     "min_advance_minutes" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "slot_step_minutes" SMALLINT NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "consent_at" TIMESTAMPTZ(3),
    "consent_source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'confirmed',
    "manage_token_hash" TEXT,
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_blocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_manage_token_hash_key" ON "appointments"("manage_token_hash");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_professional_id_starts_at_idx" ON "appointments"("tenant_id", "professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_customer_id_idx" ON "appointments"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "time_blocks_tenant_id_professional_id_starts_at_idx" ON "time_blocks"("tenant_id", "professional_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "time_blocks_tenant_id_id_key" ON "time_blocks"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "rate_limit_hits_bucket_key_created_at_idx" ON "rate_limit_hits"("bucket", "key", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_hits_created_at_idx" ON "rate_limit_hits"("created_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_professional_id_fkey" FOREIGN KEY ("tenant_id", "professional_id") REFERENCES "professionals"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "services"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_tenant_id_professional_id_fkey" FOREIGN KEY ("tenant_id", "professional_id") REFERENCES "professionals"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrições fora do alcance do schema Prisma. Mantidas à mão nesta migração.

-- Parâmetros da agenda (D3). Padrões: passo 15 min, buffer 0, antecedência 2 h, janela 60 dias,
-- prazo de cancelamento 2 h. Minutos em múltiplos de 5 onde viram grade.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slot_step_minutes_check"
    CHECK ("slot_step_minutes" BETWEEN 5 AND 120 AND "slot_step_minutes" % 5 = 0);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_buffer_minutes_check"
    CHECK ("buffer_minutes" BETWEEN 0 AND 120 AND "buffer_minutes" % 5 = 0);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_min_advance_minutes_check"
    CHECK ("min_advance_minutes" BETWEEN 0 AND 43200);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_max_window_days_check"
    CHECK ("max_window_days" BETWEEN 1 AND 365);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cancel_deadline_minutes_check"
    CHECK ("cancel_deadline_minutes" BETWEEN 0 AND 43200);

-- Telefone do cliente normalizado: só dígitos, DDI 55 + DDD + número (10 ou 11 dígitos) (D5).
ALTER TABLE "customers" ADD CONSTRAINT "customers_phone_check" CHECK ("phone" ~ '^55[0-9]{10,11}$');

-- Intervalos [início, fim) com fim depois do início.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_range_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_range_check" CHECK ("ends_at" > "starts_at");

-- Dois agendamentos confirmed do mesmo profissional não se sobrepõem, inclusive sob concorrência (D8).
-- Cancelados e concluídos ficam de fora; intervalos que só se encostam (10:00-11:00 e 11:00-12:00) passam.
-- btree_gist já foi criada na migração init (working_hours).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
    EXCLUDE USING gist (
        "professional_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    ) WHERE ("status" = 'confirmed');

-- Slugs reservados (D1): o site público fica em /{slug}. Tenants que já usam um deles ganham o
-- primeiro sufixo livre (login -> login-2 ...), como o cadastro faz. Lista igual a
-- src/server/auth/reserved-slugs.ts (o teste agenda-schema confere).
DO $$
DECLARE
    reserved TEXT[] := ARRAY['api', 'b', 'cadastro', 'login', 'logout', 'painel', 'fonts', 'favicon', 'robots', 'sitemap', 'manifest', 'next', 'static', 'assets', 'public', 'admin', 'agenda', 'agendamento', 'agendar', 'ajuda', 'app', 'auth', 'blog', 'configuracoes', 'conta', 'contato', 'docs', 'entrar', 'health', 'planos', 'precos', 'privacidade', 'sair', 'sobre', 'status', 'suporte', 'termos', 'webhooks', 'www', 'algoritmi', 'slotz'];
    t RECORD;
    n INT;
BEGIN
    FOR t IN SELECT "id", "slug" FROM "tenants" WHERE "slug" = ANY (reserved) ORDER BY "created_at" LOOP
        n := 2;
        WHILE EXISTS (SELECT 1 FROM "tenants" WHERE "slug" = t."slug" || '-' || n) LOOP
            n := n + 1;
        END LOOP;
        UPDATE "tenants" SET "slug" = t."slug" || '-' || n, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = t."id";
        RAISE NOTICE 'slug reservado renomeado: % -> %', t."slug", t."slug" || '-' || n;
    END LOOP;
END
$$;
