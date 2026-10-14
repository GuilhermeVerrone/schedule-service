# Impacto: Lembretes de agenda

Lido o código real em 2026-10-14. Os números de fase abaixo são provisórios; o passo 4 fecha a ordem.

| Camada | Afetada? | O quê | Risco |
|--------|----------|-------|-------|
| Infraestrutura | pouco | Redis, worker e fila `outbound` já existem. Jobs atrasados (até ~24 h) no mesmo Redis, 2 por agendamento. Entra uma varredura periódica no worker (lembrete `pending` sem job; pendência 19 da Fatia 4). Sem serviço novo | Redis perder os jobs: a varredura reagenda. Varredura duplicar envio: idempotência por chave e `jobId` determinístico |
| Arquitetura | sim | Módulo novo `src/server/reminders` (agendar, cancelar, sincronizar, responder). `enqueueMessage`: `appointmentId` hoje só é exigido para a confirmação; passa a valer para os 6 tipos novos (lembretes e respostas). Ganha operação de cancelar job pelo id da linha. Gancho único de sincronização em `booking.ts` (criar manual, reagendar) e `public-booking.ts` (criar público, cancelar e reagendar por token) e na rota de cancelar/concluir do dono. Webhook (`webhook.ts`) ganha o tratamento da resposta, depois do commit, como o opt-out | Esquecer um caminho de cancelar/reagendar (há 5): lembrete sai para horário errado. Mitigação: checagem no envio (snapshot do horário e status) além de remover o job. Falha de Redis nos ganchos não pode derrubar o agendamento (D12) |
| Visual | sim | `/painel/configuracoes`: bloco "Lembretes" (2 interruptores). `/painel/mensagens`: tela de templates ganha 6 tipos (rótulos, variáveis, `{{opcoes}}` obrigatória no 24 h). Agenda do painel: selo "Cliente confirmou". Resto da UI não muda | Estados de carregando, erro e vazio dos blocos novos. Template salvo sem `{{opcoes}}` quebra o fluxo de resposta. Selo em celular |
| Dados | sim | Migração: `reminder_settings`, `appointment_reminders`, `appointments.client_confirmed_at`; troca dos 2 CHECKs de `message_type` (6 tipos novos, pendência 6 da Fatia 4); possível `canceled` no CHECK de status do envio. Backfill: `reminder_settings` e templates por tenant; lembretes dos agendamentos futuros já existentes. Índices em `appointment_reminders` (tenant+agendamento, tenant+status+`scheduled_for`, tenant+contato+`status`) | Linha `outbound_messages` fica `queued` sem job quando o lembrete é cancelado (hoje o CHECK não tem estado de cancelado; decidir entre `expired` com motivo ou novo valor). Migração com CHECK em tabela viva. Backfill rodar duas vezes (deve ser idempotente) |
| LGPD | pouco | Sem dado pessoal novo; `client_confirmed_at` é registro do próprio cliente. Textos usam nome, serviço, data e hora que já são tratados. Respostas do cliente entram em `messages` como hoje | Retenção continua sem prazo (pendência 3 da Fatia 4). Lembrete respeita opt-out e elegibilidade (regra b com agendamento `confirmed`) |
| Performance | pouco | 2 linhas de lembrete e 2 jobs por agendamento. Busca da resposta: último lembrete `sent` do contato (índice). Varredura por tenant em lote | Varredura sem limite de lote. Lembretes de muitos agendamentos no mesmo minuto disputam o teto do número: o worker já adia, mas o de 2 h pode vencer antes de sair |
| Segurança | sim | Resposta resolve o contato pelo telefone dentro do tenant da sessão do webhook (já validado) e só afeta agendamento desse contato. Texto do cliente nunca vai para log. Config só pelo dono autenticado | "2" cancelar agendamento de outro cliente se o vínculo for frouxo (usar só o lembrete `sent` do próprio contato). Reprocessar o mesmo webhook cancelar/confirmar duas vezes (idempotência pelo evento + `replied_at`) |

## Pontos de código que o plano precisa tocar (fatos)
- `OUTBOUND_MESSAGE_TYPES` ([message-types.ts](src/server/outbound/message-types.ts)), `TEMPLATE_VARIABLES` e `DEFAULT_TEMPLATES` ([templates.ts](src/server/outbound/templates.ts)), `TYPE_POLICY` ([send-policy.ts](src/server/outbound/send-policy.ts)), `buildMessageContent` ([content.ts](src/server/outbound/content.ts)) e o `enqueueInputSchema` ([enqueue.ts](src/server/outbound/enqueue.ts)): todos são `Record` ou lista fechada sobre os tipos; o TypeScript aponta cada lugar.
- Expiração: `SEND_EXPIRY_MS` (24 h de atraso) não serve ao lembrete de 2 h. Ele precisa expirar quando o horário do agendamento chegar. A política por tipo ganha um limite de validade.
- Janela: `windowExempt` é falso para lembretes (D4 do Discovery: 8h se ainda couber). O worker precisa recusar o envio depois do início do atendimento.
- `content.ts` já barra agendamento não `confirmed`; falta comparar o horário com o `starts_at_snapshot` do lembrete.
- Opt-out: `OPT_OUT_WORDS` em [opt-out.ts](src/server/messaging/opt-out.ts) perde `CANCELAR`; `tests/opt-out.test.ts` (19 K) e o README citam a palavra.
- Testes que contam os tipos: `tests/message-templates.test.ts`, `outbound-schema.test.ts`, `outbound-panel-api.test.ts`.
- `/api/settings` hoje só devolve campos do `Tenant`; os lembretes ficam em rota própria (`/api/reminder-settings`) para não misturar.
- Rodar a suíte contra o branch test do Neon segue instável (pendência 22 da Fatia 4); testes de concorrência da agenda também (22b).

## Riscos que viram fase ou item de fase
- Opt-out sem `CANCELAR` (D10, altera Fatia 4) -> fase 1
- Migração, CHECKs, tabelas, `client_confirmed_at`, estado de envio cancelado, backfill de tenants -> fase 2
- Novos tipos, variáveis, `{{opcoes}}`, política de janela/validade por tipo, checagem do snapshot no envio -> fase 3
- Fiação da confirmação de agendamento (D8) e agendar/cancelar/sincronizar lembretes nos 5 caminhos -> fases 4 e 5
- Configuração por tenant (API e bloco em configurações) -> fase 6
- Parser de resposta, vínculo ao lembrete, idempotência, respostas e prazo de cancelamento -> fase 7
- Selo na agenda e templates no painel -> fase 8
- Varredura de lembretes sem job e backfill de agendamentos futuros -> fase 9
- Fechamento com a verificação de que nada sai fora da fila -> fase 10
