# Plano: whatsapp-conexao-mensagens (aprovado em 2026-10-10)

Um chat novo por fase. Refs: guia (itens 1-9) e decisões (D1-D12). Pré-requisito de toda fase: `pnpm lint`, `pnpm typecheck`, `pnpm check:tenant-access` e `pnpm test` verdes ao terminar. A Fatia 2 já está concluída e commitada.

## Fase 1: Contact e telefone E.164 (refatoração)
- Escopo: renomear Customer para Contact (tabela, modelo, relações, FKs compostas, repositório, serializers, rotas, telas, testes, E2E) sem mudar comportamento; colunas `opt_out` e `last_inbound_at`; função única de normalização E.164 (qualquer E.164 válido, padrão 55, nono dígito do BR coberto); migração dos telefones existentes de `55...` para `+55...` e novo CHECK; unique `(tenant_id, phone)` preservado.
- Fora: tabelas do WhatsApp, adapter, telas novas.
- Pronto quando: migração aplica em dev e test sem duplicar nem perder telefone; a suíte da Fatia 2 (API, repositório, E2E de agendamento) passa com os nomes novos; testes da normalização cobrem DDI 55 implícito, número internacional, nono dígito e entradas inválidas.
- Refs: guia 5; D1, D2, D11.

## Fase 2: Schema do WhatsApp
- Escopo: modelos WhatsAppConnection (1 por tenant, status, `session_id` único, última checagem, contadores e limites diários), Conversation, Message (unicidade `tenant_id + external_id`, mídia só como tipo) e WebhookEvent (origem + id do evento únicos); FKs compostas (tenant_id, id), CHECKs de status e índices de listagem; migrações em dev e test.
- Fora: repositórios, adapter, API, telas.
- Pronto quando: migração aplica nas duas branches; teste de SQL direto prova a unicidade de conexão por tenant, de `session_id`, de mensagem por id externo e de evento de webhook, e a recusa de FK entre tenants; `check-tenant-access` continua verde.
- Refs: guia 5; D1, D7, D8.

## Fase 3: Adapter, FakeProvider e AkgProvider
- Escopo: interface `WhatsAppProvider` (`connect`, `getStatus`, `sendText`, `disconnect`, `onInboundMessage`, `onStatusUpdate`), eventos normalizados (`InboundMessage`, `DeliveryStatus`, `ConnectionStatus`), `FakeProvider` que simula QR, queda, mensagem e registra envios, `AkgProvider` com endpoints TODO isolados e lista do que confirmar, fábrica por env; `.env.example` com `AKG_BASE_URL`, `AKG_API_KEY` e `WHATSAPP_WEBHOOK_SECRET`.
- Fora: banco, rotas, telas.
- Pronto quando: testes do contrato rodam contra o `FakeProvider` cobrindo todos os eventos; teste de varredura prova que nenhum arquivo fora de `src/server/whatsapp/` referencia o AKG; nenhum segredo no repositório.
- Refs: guia 3, 6; D4, D5.

## Fase 4: Repositórios
- Escopo: repositórios por tenant para conexão, conversas e mensagens (paginação de 50); repositório do webhook que resolve o tenant só por `sessionId` e grava evento, contato, conversa e mensagem; mensagem recebida cria ou atualiza Contact (nome do perfil, origem `whatsapp_inbound`) e `last_inbound_at`; ajuste do `check-tenant-access` se o repositório do webhook precisar de exceção explícita.
- Fora: rotas, telas.
- Pronto quando: testes provam isolamento (inclusive por ID) em conexão, conversa e mensagem; evento duplicado grava uma única vez; `sessionId` desconhecido não altera nada; `last_inbound_at` é atualizado.
- Refs: guia 5, 6, 9; D1, D3, D8, D12.

## Fase 5: API (webhook e painel)
- Escopo: `/api/webhooks/whatsapp` pública no `proxy.ts` (sem sessão e sem `tenantId` injetado), segredo em tempo constante, limite por IP, corpo inválido responde 200 vazio, processamento no mesmo request; rotas autenticadas para conectar (QR), ver status, reconectar, desconectar, listar conversas e mensagens; validação Zod e erro padrão.
- Fora: telas.
- Pronto quando: testes cobrem token inválido, sessão desconhecida, duplicado, corpo inválido, rate limit, fluxo de conexão com `FakeProvider` (QR, conectado, queda, reconectar, desconectar) e que o tenant A é negado em todas as rotas do B e sem sessão; nenhuma rota aceita `tenantId` do cliente; a resposta nunca contém `AKG_API_KEY`.
- Refs: guia 3, 4, 6, 7, 9; D3, D6, D8.

## Fase 6: Tela de conexão
- Escopo: `/painel/whatsapp` com aviso de risco de banimento, QR code com expiração e atualização, status, alerta de queda, reconectar e desconectar; polling curto que para ao sair da tela; item no menu; estados vazio, carregando e erro; mobile-first.
- Fora: conversas.
- Pronto quando: Playwright com `FakeProvider` cobre conectar, queda, reconectar e desconectar em mobile e desktop com prints, fiel ao DESIGN.md.
- Refs: guia 3, 7a, 7b, 7e; D5.

## Fase 7: Tela de conversas
- Escopo: `/painel/conversas` com lista (contato, última mensagem, horário) e página por conversa com 50 mensagens por página, somente leitura; mídia como "[imagem]"/"[áudio]"; item no menu; estados vazio, carregando e erro; mobile-first.
- Fora: responder mensagens.
- Pronto quando: Playwright cobre a chegada de mensagem pelo webhook do `FakeProvider` e a leitura da conversa em mobile e desktop com prints; conversas de outro tenant nunca aparecem.
- Refs: guia 3, 7c, 7d; D6, D7.

## Fase 8: Fechamento
- Escopo: revisão contra o "pronto" do guia; README (rotas, env, webhook, limites do WA não oficial); varredura de segredos; suíte completa e `pnpm build`; pendências registradas (Swagger do AKG, exclusão de dados, fila na Fatia 4, `x-forwarded-for`).
- Fora: funcionalidade nova.
- Pronto quando: cada item de "pronto" do guia tem evidência; `pnpm lint`, `typecheck`, `check:tenant-access`, `test`, `build` e `test:e2e` passam.
- Refs: guia 9; D1-D12.

## Progresso
- [x] Fase 1  - [x] Fase 2  - [x] Fase 3  - [x] Fase 4  - [x] Fase 5  - [x] Fase 6  - [x] Fase 7  - [x] Fase 8
