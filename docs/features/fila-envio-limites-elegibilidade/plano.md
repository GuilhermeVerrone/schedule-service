# Plano: fila-envio-limites-elegibilidade (aprovado em 2026-10-11)

Um chat novo por fase. Refs: guia (itens 1-9) e decisões (D1-D16). Pré-requisito de toda fase: `pnpm lint`, `pnpm typecheck`, `pnpm check:tenant-access` e `pnpm test` verdes ao terminar. Só começa com a Fatia 3 concluída e commitada.

## Fase 1: Infraestrutura (Docker, Redis e worker)
- Escopo: `Dockerfile`, `docker-compose.yml` com `app`, `worker` e `redis` (sem porta pública, senha, AOF, `noeviction`); `bullmq` e `ioredis`; entrada separada do worker com script no `package.json`, sem depender de contexto de request do Next; rota de saúde; `REDIS_URL` no `.env.example`; Redis local para os testes de integração.
- Fora: lógica de envio, banco, e-mail, deploy na VPS (proxy, HTTPS, domínio, backup).
- Pronto quando: `docker compose up` sobe os três serviços saudáveis; o worker conecta ao Redis, processa um job de teste e encerra limpo; a rota de saúde responde; o Redis não é acessível de fora da rede do Compose; nenhum segredo no repositório.
- Refs: guia 5, 6; D1, D2.

## Fase 2: Schema
- Escopo: tabelas `outbound_messages` (status `queued|sent|failed|blocked|expired`, canal, motivo do bloqueio, chave de idempotência única por tenant, agendado para) e `message_templates` (tipo da lista fechada, variações, ativo); data da primeira conexão em `whatsapp_connections`; `daily_send_limit` passa a nulo e opcional; marcador de confirmação de opt-out em `contacts`; FKs compostas (tenant_id, id), CHECKs e índices; migrações em dev e test.
- Fora: repositórios, regras, fila.
- Pronto quando: migração aplica nas duas branches sem perder dado; SQL direto prova a unicidade da chave de idempotência por tenant, a recusa de FK entre tenants e dos CHECKs; `check-tenant-access` continua verde.
- Refs: guia 5; D5, D14, D15, D16.

## Fase 3: Elegibilidade
- Escopo: função `isContactEligibleForProactive` com as 3 regras (iniciou conversa há até 30 dias; agendamento `confirmed`, plano ou cobrança ativa; cadastrado com consentimento registrado) e bloqueio por `opt_out`; devolve o motivo; leitura por repositório com tenantId.
- Fora: fila, envio, opt-out por mensagem.
- Pronto quando: testes cobrem cada regra isolada, ausência de todas, fronteira dos 30 dias, agendamento cancelado não conta, `opt_out` vence qualquer regra e contato de outro tenant nunca é considerado.
- Refs: guia 6; D13.

## Fase 4: Política de envio
- Escopo: função pura e testada sem Redis: intervalo aleatório de 8 a 25 s, teto diário pela curva de aquecimento de 14 dias (contada da primeira conexão), teto manual opcional, "dia" no fuso do tenant, janela de 8h às 20h com exceção da confirmação de agendamento, adiamento para o dia seguinte e expiração após 24 h; contador diário atômico no SQL.
- Fora: fila, worker, envio real.
- Pronto quando: testes cobrem cada degrau do aquecimento, reconexão sem zerar, virada do dia em fuso diferente de São Paulo, teto atingido, janela fora de horário, prioridade da confirmação, expiração e dois consumos simultâneos do contador sem passar do teto.
- Refs: guia 6, 7e; D3, D7, D9, D11, D14.

## Fase 5: Templates
- Escopo: repositório de templates por tenant, textos padrão no código para `appointment_confirmation` e `optout_confirmation` criados com o tenant (e para os existentes), 3 ou mais variações, variáveis tipadas com validação, escolha ao acaso sem repetir a última usada para o mesmo contato.
- Fora: API, tela, demais tipos de mensagem.
- Pronto quando: testes provam variável desconhecida recusada, texto vazio recusado, não repetir a última variação, isolamento por tenant (inclusive por ID) e que tipo fora da lista fechada é recusado.
- Refs: guia 5, 6; D5, D16.

## Fase 6: Fila e worker
- Escopo: `enqueueMessage` (payload só com ids e a chave de idempotência; texto montado no worker); worker BullMQ com concorrência por tenant, que valida o `tenantId` no banco, aplica elegibilidade e política antes de cada tentativa, envia por `sendText` do adapter, registra em `outbound_messages` e na conversa; retentativa de 1, 5 e 15 min; bloqueio registrado com motivo; Redis fora do ar vira `failed` visível.
- Fora: opt-out, e-mail, API, telas.
- Pronto quando: testes de integração com Redis e `FakeProvider` cobrem envio, bloqueio por inelegível, adiado por teto, expirado, retentativa sem gastar o teto, evento duplicado enviando uma vez e Redis indisponível; teste de varredura prova que nenhum `sendText` fora do worker é chamado.
- Refs: guia 6, 7a, 7b, 7e; D1, D3, D7, D10, D12.

## Fase 7: Opt-out
- Escopo: detecção no fluxo do webhook (mensagem inteira igual a `SAIR`, `PARAR`, `CANCELAR` ou `STOP`, sem diferenciar maiúscula, acento ou espaço) marcando `opt_out` na hora; confirmação única pela fila (D15); `VOLTAR` reativa; frase com a palavra no meio não conta.
- Fora: reativação manual pelo dono na tela, e-mail.
- Pronto quando: testes cobrem efeito imediato, confirmação enviada uma única vez mesmo com webhook repetido, `VOLTAR`, frase que não deve descadastrar, nenhum proativo depois do opt-out e isolamento por tenant.
- Refs: guia 6, 7c; D4, D15.

## Fase 8: Fallback por e-mail
- Escopo: interface `EmailProvider` com `FakeEmailProvider` e provedor real por env (sugestão Resend, a confirmar); troca de canal quando a conexão está caída ou `banned_suspected`; contato sem e-mail vira `blocked` com `no_channel`; `EMAIL_FROM_DOMAIN` e chaves no `.env.example`.
- Fora: lembretes e cobrança por e-mail, deploy do domínio de envio (SPF/DKIM/DMARC).
- Pronto quando: testes cobrem WhatsApp caído enviando por e-mail, `no_channel`, opt-out valendo também no e-mail e nenhum segredo no repositório.
- Refs: guia 6, 7d; D8, premissa do provedor de e-mail.

## Fase 9: API do painel
- Escopo: rotas autenticadas para uso do dia, fase do aquecimento, lista de bloqueios com motivo e CRUD de templates; validação Zod e erro padrão.
- Fora: telas.
- Pronto quando: testes de API cobrem leitura, edição e casos inválidos e provam que o tenant A é negado em todas as rotas do B e sem sessão; nenhuma rota aceita `tenantId` do cliente.
- Refs: guia 3, 5, 7f; D5, D6.

## Fase 10: Tela de uso e bloqueios
- Escopo: bloco só leitura em `/painel/whatsapp` com uso de hoje ("42 de 200"), fase do aquecimento e lista de bloqueios com motivo; estados vazio, carregando e erro; mobile-first.
- Fora: templates.
- Pronto quando: Playwright com `FakeProvider` cobre o bloco com dados e vazio, em mobile e desktop com prints, fiel ao DESIGN.md.
- Refs: guia 3, 7f; D6.

## Fase 11: Tela de templates
- Escopo: nova tela (ex.: `/painel/mensagens`) com lista por tipo, edição das variações com variáveis, pré-visualização como texto puro, restaurar padrão; item no menu; estados vazio, carregando e erro; mobile-first.
- Fora: criar tipos novos de mensagem.
- Pronto quando: Playwright cobre editar, validar variável inválida e restaurar padrão, em mobile e desktop com prints, fiel ao DESIGN.md.
- Refs: guia 3; D5, D16.

## Fase 12: Fechamento
- Escopo: revisão contra o "pronto" do guia; README (Compose, worker, env, política de envio, opt-out); varredura de segredos; suíte completa, `pnpm build` e `docker compose build`; pendências registradas (deploy na VPS, provedor real de e-mail, exclusão de dados do cliente).
- Fora: funcionalidade nova.
- Pronto quando: cada item de "pronto" do guia tem evidência; `pnpm lint`, `typecheck`, `check:tenant-access`, `test`, `build` e `test:e2e` passam.
- Refs: guia 9; D1-D16.

## Progresso
- [x] Fase 1  - [x] Fase 2  - [ ] Fase 3  - [ ] Fase 4  - [ ] Fase 5  - [ ] Fase 6  - [ ] Fase 7  - [ ] Fase 8  - [ ] Fase 9  - [ ] Fase 10  - [ ] Fase 11  - [ ] Fase 12
