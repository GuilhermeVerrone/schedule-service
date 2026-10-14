# Plano: lembretes-agenda (aguardando aprovação)

Um chat novo por fase. Refs: guia (itens 1-9) e decisões (D1-D12 de decisoes.md). Pré-requisito de toda fase: `pnpm lint`, `pnpm typecheck`, `pnpm check:tenant-access` e `pnpm test` verdes ao terminar. Só começa com a Fatia 4 concluída e commitada (já está, fase 12).

Premissa de plano: o envio cancelado ganha o status `canceled` no CHECK de `outbound_messages.status` (Fase 2), em vez de reaproveitar `expired`, para o painel de uso não confundir cancelamento com expiração.

## Fase 1: Opt-out sem CANCELAR
- Escopo: `OPT_OUT_WORDS` passa a `SAIR`, `PARAR`, `STOP`; ajustar `opt-out.ts`, textos que citem `CANCELAR`, README e os testes da Fatia 4 (`tests/opt-out.test.ts` e os que usam a palavra).
- Fora: leitura de resposta a lembrete, tabelas, qualquer lembrete.
- Pronto quando: testes provam que `CANCELAR` sozinho não marca `opt_out`, que `SAIR`, `PARAR` e `STOP` continuam com efeito imediato e confirmação única, e que `VOLTAR` reativa; suíte verde.
- Refs: guia 6; D10.

## Fase 2: Schema
- Escopo: migração com `reminder_settings` (tenant, tipo `reminder_24h|reminder_2h`, `enabled`, `offset_minutes`, único por tenant e tipo), `appointment_reminders` (agendamento, contato, tipo, `starts_at_snapshot`, `scheduled_for`, `status` pending/sent/canceled/expired, `outbound_message_id`, `reply_prompt_sent_at`, `replied_at`, único por agendamento, tipo e horário, índices de impacto.md), `appointments.client_confirmed_at`; troca dos 2 CHECKs de tipo de mensagem pelos 6 tipos novos; `canceled` no CHECK de status do envio; FKs compostas (tenant_id, id); migração em dev e test; backfill idempotente de `reminder_settings` (padrão ligado) para tenants existentes e criação junto com o tenant novo.
- Fora: repositórios, regras, fila, telas.
- Pronto quando: migração aplica nas duas branches sem perder dado; SQL direto prova unicidade, recusa de FK entre tenants e dos CHECKs; backfill rodado duas vezes não duplica; `check-tenant-access` verde.
- Refs: guia 5; D1, D2, D3, D9.

## Fase 3: Tipos, templates e política de envio
- Escopo: 6 tipos em `OUTBOUND_MESSAGE_TYPES`, variáveis (data, hora, serviço, profissional, negócio, `{{opcoes}}` obrigatória no 24 h), textos padrão com 3 variações e criação para tenants novos e existentes; política por tipo em `send-policy`: lembretes não isentos da janela, regra da D4 (2 h fora da janela sai às 8h se ainda antes do atendimento), validade até o início do atendimento no lugar das 24 h; `enqueueMessage` exige `appointmentId` para os tipos novos; `buildMessageContent` compara o horário com o snapshot do lembrete e barra agendamento passado, cancelado ou reagendado; operação de cancelar job e linha de envio.
- Fora: agendamento de lembretes, webhook, telas.
- Pronto quando: testes cobrem validação de `{{opcoes}}`, variável desconhecida, janela e validade (lembrete de 2 h às 6h30 vai às 8h, após o atendimento não sai, 24 h dentro da janela), snapshot divergente bloqueado, isolamento por tenant e tipos fora da lista recusados.
- Refs: guia 5, 6; D4, D7, D9, D11.

## Fase 4: Fiação da confirmação de agendamento
- Escopo: criação pública e manual enfileiram `appointment_confirmation` (chave `appointment_confirmation:<appointmentId>`) depois do commit; falha de Redis não derruba o agendamento; texto só informa, sem opções.
- Fora: lembretes, respostas.
- Pronto quando: testes de integração provam uma confirmação por agendamento, nenhuma duplicada em repetição, agendamento criado com Redis fora do ar e confirmação `failed` visível.
- Refs: guia 7a; D8, D12.

## Fase 5: Serviço de lembretes
- Escopo: módulo `src/server/reminders`: calcular os lembretes de um agendamento (regras das D4 e D5 e da config do tenant), criar linhas e enfileirar com `scheduledFor`, cancelar os pendentes, sincronizar (cancela e recria); ganchos pós-commit nos 5 caminhos (criar manual, criar público, reagendar pelo dono e pelo cliente, cancelar pelo dono e pelo cliente, concluir); reagendar zera `client_confirmed_at`.
- Fora: configuração do dono, resposta do cliente, telas, varredura.
- Pronto quando: testes cobrem 2 lembretes criados, menos de 24 h só o de 2 h, reagendar cancela os antigos e cria novos, cancelar e concluir deixam zero pendentes, idempotência (sincronizar duas vezes não duplica), lembrete antigo que dispara depois do reagendamento é barrado no envio, opt-out e inelegibilidade bloqueiam, e nenhum lembrete sai sem `enqueueMessage`.
- Refs: guia 6, 7a, 7b, 7e, 9; D3, D4, D5.

## Fase 6: Configuração por tenant
- Escopo: repositório e rota `/api/reminder-settings` (GET e PATCH só de `enabled`, dono autenticado); desligar cancela os pendentes dos agendamentos futuros, ligar agenda os que ainda couberem; bloco "Lembretes" em `/painel/configuracoes` com os dois interruptores, estados de carregando, erro e salvo, responsivo.
- Fora: antecedência e janela configuráveis, templates.
- Pronto quando: testes de API (401, 400 campo desconhecido, isolamento por tenant), de desligar/ligar com agendamentos futuros e de lembrete desligado não agendado; prints do bloco em desktop e celular.
- Refs: guia 3, 4, 6, 7g, 9; D1.

## Fase 7: Resposta do cliente
- Escopo: parser de texto simples (D6) puro; vínculo ao último lembrete `sent` sem `replied_at`, de agendamento futuro `confirmed`, até 24 h depois; "1" marca `client_confirmed_at`; "2" cancela dentro do prazo (`cancelDeadlineMinutes`) e cancela os lembretes pendentes, fora do prazo responde `appointment_reply_cancel_denied`; fora do padrão ou ambíguo envia `appointment_reply_help` uma vez por lembrete; respostas pela fila; tratamento depois do commit no webhook, idempotente pelo evento e por `replied_at`; texto longo ou sem lembrete aberto é ignorado; texto do cliente nunca no log.
- Fora: chatbot, intenção livre, múltiplos idiomas.
- Pronto quando: testes cobrem 1, 2, "sim", "não vou", "sim mas não posso", texto longo, sem lembrete anterior, lembrete antigo (mais de 24 h), cliente com dois agendamentos, prazo vencido, opt-out ativo, reprocessar o mesmo webhook e contato de outro tenant; `CANCELAR` com lembrete aberto cancela e não faz opt-out.
- Refs: guia 6, 7c, 7d, 7f, 9; D6, D7, D10.

## Fase 8: Painel (selo e templates)
- Escopo: selo "Cliente confirmou" na agenda (desktop e celular); tela de templates com os 6 tipos novos (rótulos, variáveis, aviso de `{{opcoes}}` obrigatório, prévia com dados do tipo); API de templates aceitando os tipos novos.
- Fora: edição de config na tela de templates, reativação de opt-out.
- Pronto quando: testes da API de templates para os tipos novos e para `{{opcoes}}` ausente; prints da agenda com e sem selo e da tela de templates (vazio, erro, carregando, celular).
- Refs: guia 3, 5, 9; D2, D9, D11.

## Fase 9: Varredura e backfill
- Escopo: varredura periódica no worker que reenfileira lembretes `pending` sem job (em lotes) e marca expirados; script idempotente que cria lembretes para os agendamentos futuros já existentes; registro em log estruturado.
- Fora: varredura geral de `outbound_messages` de outros tipos (pendência 19 da Fatia 4), deploy.
- Pronto quando: testes provam reenfileiramento após perda do Redis, sem duplicar, respeito ao lote, backfill duas vezes sem duplicar e agendamento passado ignorado.
- Refs: guia 6, 9; D3, D12.

## Fase 10: Fechamento
- Escopo: suíte completa (lint, typecheck, `check:tenant-access`, testes e E2E do fluxo confirmação, lembrete e resposta com `FakeProvider`); varredura de teste de que lembretes só saem pelo worker; conferir cada item de "pronto" do guia; `pendencias.md`, `README` (variáveis e comandos) e `.env.example` se mudarem.
- Fora: qualquer funcionalidade nova.
- Pronto quando: cada item do campo 9 do guia tem evidência; pendências registradas.
- Refs: guia 9.
