-- Fatia 3, Fase 2 (guia 5; D1, D7, D8): conexão do WhatsApp, conversas, mensagens e eventos de webhook.
-- Tudo com tenant_id; conversa e mensagem apontam para contato e conversa pela FK composta
-- (tenant_id, id), então nunca cruzam tenants, nem por bug no código.

-- CreateTable
CREATE TABLE "whatsapp_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "session_id" TEXT NOT NULL,
    "last_checked_at" TIMESTAMPTZ(3),
    "daily_sent_count" INTEGER NOT NULL DEFAULT 0,
    "daily_count_date" DATE,
    "daily_send_limit" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT,
    "media_type" TEXT,
    "status" TEXT NOT NULL,
    "external_id" TEXT,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_tenant_id_key" ON "whatsapp_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_connections_session_id_key" ON "whatsapp_connections"("session_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_id_key" ON "conversations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_contact_id_key" ON "conversations"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_sent_at_idx" ON "messages"("tenant_id", "conversation_id", "sent_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_id_key" ON "messages"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_external_id_key" ON "messages"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "webhook_events_tenant_id_created_at_idx" ON "webhook_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_event_id_key" ON "webhook_events"("source", "event_id");

-- AddForeignKey
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_conversation_id_fkey" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restrições que o Prisma não expressa. Status, direção e mídia ficam em texto com CHECK
-- (e não enum) para crescer sem ALTER TYPE.
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_status_check"
CHECK ("status" IN ('connected', 'disconnected', 'qr_pending', 'banned_suspected'));
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_session_id_check"
CHECK (length("session_id") > 0);
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_daily_check"
CHECK ("daily_sent_count" >= 0 AND "daily_send_limit" > 0);

ALTER TABLE "messages" ADD CONSTRAINT "messages_direction_check"
CHECK ("direction" IN ('inbound', 'outbound'));
-- Recebida é sempre `received`; enviada segue o ciclo de entrega do provedor.
ALTER TABLE "messages" ADD CONSTRAINT "messages_status_check"
CHECK (("direction" = 'inbound' AND "status" = 'received')
    OR ("direction" = 'outbound' AND "status" IN ('pending', 'sent', 'delivered', 'read', 'failed')));
-- Mídia só como tipo (D7), sem arquivo nem URL.
ALTER TABLE "messages" ADD CONSTRAINT "messages_media_type_check"
CHECK ("media_type" IS NULL OR "media_type" IN ('image', 'audio', 'video', 'document', 'sticker', 'other'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_content_check"
CHECK ("body" IS NOT NULL OR "media_type" IS NOT NULL);
-- Idempotência: toda recebida tem id externo (único por tenant); enviada pode esperar a confirmação.
ALTER TABLE "messages" ADD CONSTRAINT "messages_external_id_check"
CHECK (("direction" = 'outbound' OR "external_id" IS NOT NULL) AND ("external_id" IS NULL OR length("external_id") > 0));

ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_source_check"
CHECK ("source" ~ '^[a-z][a-z0-9_]{0,31}$');
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_event_id_check"
CHECK (length("event_id") > 0);
