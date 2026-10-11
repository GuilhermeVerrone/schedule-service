-- Fatia 3, Fase 1 (D1, D2, D11): customers vira contacts e o telefone passa a E.164.
-- Só renomeia (sem recriar), para não perder linhas nem os vínculos dos agendamentos.

-- Tabela, chaves e índices com os nomes que o Prisma espera para o modelo Contact.
ALTER TABLE "customers" RENAME TO "contacts";
ALTER TABLE "contacts" RENAME CONSTRAINT "customers_pkey" TO "contacts_pkey";
ALTER TABLE "contacts" RENAME CONSTRAINT "customers_tenant_id_fkey" TO "contacts_tenant_id_fkey";
ALTER INDEX "customers_tenant_id_id_key" RENAME TO "contacts_tenant_id_id_key";
ALTER INDEX "customers_tenant_id_phone_key" RENAME TO "contacts_tenant_id_phone_key";

-- Agendamentos apontam para o contato pela FK composta (tenant_id, contact_id).
ALTER TABLE "appointments" RENAME COLUMN "customer_id" TO "contact_id";
ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_tenant_id_customer_id_fkey" TO "appointments_tenant_id_contact_id_fkey";
ALTER INDEX "appointments_tenant_id_customer_id_idx" RENAME TO "appointments_tenant_id_contact_id_idx";

-- Opt-out ("SAIR") e última mensagem recebida, usados a partir da Fatia 4.
ALTER TABLE "contacts" ADD COLUMN "opt_out" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "last_inbound_at" TIMESTAMPTZ(3);

-- Telefone: de "5511987654321" para "+5511987654321". Prefixar "+" é injetivo, então o único
-- (tenant_id, phone) segue valendo sem duplicar nem perder número. Qualquer linha fora do
-- formato antigo faz a migração falhar (o CHECK antigo garantia que não existe).
ALTER TABLE "contacts" DROP CONSTRAINT "customers_phone_check";
UPDATE "contacts" SET "phone" = '+' || "phone" WHERE "phone" ~ '^55[0-9]{10,11}$';

-- E.164: "+", DDI sem zero à esquerda e 10 a 15 dígitos no total (D11). As regras do Brasil
-- (DDD, nono dígito) ficam em src/lib/phone.ts, a única porta de entrada do telefone.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_check" CHECK ("phone" ~ '^\+[1-9][0-9]{9,14}$');
