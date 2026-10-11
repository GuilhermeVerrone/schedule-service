-- Fatia 4, Fase 2 (guia 5; D3, D5, D8, D14, D15, D16): registro de envios, templates, início do
-- aquecimento, teto manual opcional e marcador da confirmação de opt-out.
-- Envio aponta para o contato pela FK composta (tenant_id, id): nunca cruza tenants, nem por bug.
-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "opt_out_confirmation_sent_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "whatsapp_connections" ADD COLUMN     "first_connected_at" TIMESTAMPTZ(3),
ALTER COLUMN "daily_send_limit" DROP NOT NULL,
ALTER COLUMN "daily_send_limit" DROP DEFAULT;

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "message_type" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "block_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "template_variant" SMALLINT,
    "external_id" TEXT,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "message_type" TEXT NOT NULL,
    "variations" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_messages_tenant_id_status_scheduled_for_idx" ON "outbound_messages"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outbound_messages_tenant_id_contact_id_created_at_idx" ON "outbound_messages"("tenant_id", "contact_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_tenant_id_id_key" ON "outbound_messages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_tenant_id_idempotency_key_key" ON "outbound_messages"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_id_key" ON "message_templates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_tenant_id_message_type_key" ON "message_templates"("tenant_id", "message_type");

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restrições que o Prisma não expressa. Status, canal, tipo e motivo ficam em texto com CHECK
-- (e não enum), como nas tabelas do WhatsApp, para crescer sem ALTER TYPE.

-- D14: o limite efetivo vem da política de aquecimento; daily_send_limit vira teto manual opcional.
-- Nenhum código nem tela grava essa coluna até aqui, então todo 100 existente é o padrão antigo,
-- não escolha do dono: vira nulo (sem teto manual).
UPDATE "whatsapp_connections" SET "daily_send_limit" = NULL WHERE "daily_send_limit" = 100;
ALTER TABLE "whatsapp_connections" DROP CONSTRAINT "whatsapp_connections_daily_check";
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_daily_check"
CHECK ("daily_sent_count" >= 0 AND ("daily_send_limit" IS NULL OR "daily_send_limit" > 0));

-- D3: o aquecimento conta da primeira conexão. Para quem já está conectado (ou já esteve, se
-- `banned_suspected`) não há a data real: começa agora, o lado conservador (limites menores).
-- As demais recebem a data na próxima vez em `connected`.
UPDATE "whatsapp_connections" SET "first_connected_at" = CURRENT_TIMESTAMP
WHERE "status" IN ('connected', 'banned_suspected') AND "first_connected_at" IS NULL;

ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_status_check"
CHECK ("status" IN ('queued', 'sent', 'failed', 'blocked', 'expired'));
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_channel_check"
CHECK ("channel" IS NULL OR "channel" IN ('whatsapp', 'email'));
-- D16: lista fechada de eventos do sistema, sem tipo livre (sem campanhas). As Fatias 5 a 7
-- ampliam esta lista e a de message_templates na própria migração.
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_message_type_check"
CHECK ("message_type" IN ('appointment_confirmation', 'optout_confirmation'));
-- Bloqueio sempre com motivo, e motivo só no bloqueio; código curto em minúsculas.
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_block_reason_check"
CHECK ((("status" = 'blocked') = ("block_reason" IS NOT NULL))
   AND ("block_reason" IS NULL OR "block_reason" ~ '^[a-z][a-z0-9_]{0,63}$'));
-- Enviada tem canal e horário de envio; só a enviada tem horário de envio.
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_sent_check"
CHECK ((("status" = 'sent') = ("sent_at" IS NOT NULL))
   AND ("status" <> 'sent' OR "channel" IS NOT NULL));
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_idempotency_key_check"
CHECK (length("idempotency_key") BETWEEN 1 AND 255);
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_external_id_check"
CHECK ("external_id" IS NULL OR length("external_id") > 0);
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_template_variant_check"
CHECK ("template_variant" IS NULL OR "template_variant" >= 0);

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_message_type_check"
CHECK ("message_type" IN ('appointment_confirmation', 'optout_confirmation'));
-- D5: 3 ou mais variações, lista simples, sem nulo nem texto em branco. Variáveis conhecidas e
-- tamanho ficam na validação do código (Fase 5). chr(31) separa os itens só para achar um em branco.
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_variations_check"
CHECK ("variations" IS NOT NULL
   AND array_ndims("variations") = 1
   AND cardinality("variations") >= 3
   AND array_position("variations", NULL) IS NULL
   AND (chr(31) || array_to_string("variations", chr(31)) || chr(31)) !~ '\x1f\s*\x1f');
