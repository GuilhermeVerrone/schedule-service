# Slotz

Assistente de atendimento, agenda e cobrança para pequenos negócios. Este repositório tem:

- **Fatia 1** (`base-auth-tenant-servicos`): cadastro e login do dono, tenant isolado,
  profissionais, serviços e horários de trabalho.
- **Fatia 2** (`agenda-link-publico`): agenda do painel, configurações do negócio e site público
  do negócio em `/{slug}` com agendamento sem login e link de gestão do agendamento.
- **Fatia 3** (`whatsapp-conexao-mensagens`): WhatsApp não oficial atrás de um adapter, conexão
  por QR code com painel de saúde, webhook do provedor e conversas recebidas (somente leitura).
- **Fatia 4** (`fila-envio-limites-elegibilidade`): fila de envio por número (BullMQ + Redis) com
  limites anti-banimento, elegibilidade para mensagem proativa, opt-out por "SAIR", templates
  editáveis e e-mail de reserva quando o WhatsApp cai. App, worker e Redis em Docker Compose.
  aasdas
  Documentação por fatia em `docs/features/<slug>/` (guia, decisões, impacto, plano, pendências e
  evidências por fase). Contexto do produto: `prompt-guide.md`.

## Stack

- Next.js 16 (App Router) + TypeScript, API em route handlers, validação com Zod
- Prisma 7 + Postgres no Neon (adapter `pg`)
- Tailwind 4 + shadcn/ui, tema com os tokens do design system da Algoritmi
- BullMQ + Redis (ioredis) para a fila de envio; worker em processo separado (`tsx`)
- Docker Compose com `app`, `worker` e `redis`, a partir de uma imagem só
- Vitest (unidade, repositório, API e integração com Redis) e Playwright (telas)

## Pré-requisitos

- Node.js 24 e pnpm 10 (`corepack enable` usa a versão do `packageManager`)
- Um projeto Postgres no Neon com duas branches: **dev** (app local) e **test** (testes).
  Os testes apagam e criam dados: nunca aponte `TEST_*` para a branch dev ou produção.
- Docker (com Compose v2) para o Redis: o dos testes (`docker-compose.test.yml`) e a pilha
  completa (`docker-compose.yml`).

## Configuração

1. Instale as dependências (o `postinstall` gera o client do Prisma em `src/generated/`):

   ```bash
   pnpm install
   ```

2. Copie `.env.example` para `.env` e preencha. O `.env` está no `.gitignore`; nunca o versione.

   | Variável                  | Para quê                                                                                                                |
   | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
   | `DATABASE_URL`            | Branch dev, conexão pooled (app)                                                                                        |
   | `DIRECT_URL`              | Branch dev, conexão direta (migrações do Prisma)                                                                        |
   | `TEST_DATABASE_URL`       | Branch test, conexão pooled (Vitest e servidor do E2E)                                                                  |
   | `TEST_DIRECT_URL`         | Branch test, conexão direta (migração antes da suíte)                                                                   |
   | `APP_BASE_URL`            | URL base do app, ex.: `http://localhost:3000`                                                                           |
   | `PUBLIC_BOOKING_BASE_URL` | Base do link público de agendamento (fatias futuras)                                                                    |
   | `EMAIL_FROM_DOMAIN`       | Subdomínio de envio do e-mail de reserva; o remetente é `nao-responda@<domínio>`                                        |
   | `WHATSAPP_PROVIDER`       | `akg` ou `fake`. Obrigatório em produção; sem valor, o Fake é usado fora de produção                                    |
   | `AKG_BASE_URL`            | URL da instância do WA-AKG (só servidor)                                                                                |
   | `AKG_API_KEY`             | Chave da API do WA-AKG (só servidor, nunca vai ao navegador nem ao log)                                                 |
   | `WHATSAPP_WEBHOOK_SECRET` | Segredo que o provedor envia ao chamar o webhook (mínimo 16 caracteres; sem ele, todo webhook é recusado)               |
   | `REDIS_PASSWORD`          | Senha do Redis do Compose; o Compose monta o `REDIS_URL` do app e do worker com ela (obrigatória para `docker compose`) |
   | `REDIS_URL`               | URL do Redis das filas fora do Compose (`pnpm dev`, `pnpm worker`), ex.: `redis://:<senha>@127.0.0.1:6379`              |
   | `TEST_REDIS_PASSWORD`     | Senha do Redis dos testes (`docker-compose.test.yml`)                                                                   |
   | `TEST_REDIS_URL`          | URL do Redis dos testes (porta 6380, presa em 127.0.0.1)                                                                |
   | `EMAIL_PROVIDER`          | `resend` ou `fake`. Obrigatório em produção; sem valor, o Fake é usado fora de produção                                 |
   | `RESEND_API_KEY`          | Chave da API do Resend (só servidor, nunca vai ao log)                                                                  |

   O domínio nunca fica fixo no código: tudo vem dessas variáveis.

3. Confira a conexão com as duas branches (não imprime connection strings):

   ```bash
   pnpm db:check
   ```

4. Aplique as migrações na branch dev:

   ```bash
   pnpm exec prisma migrate deploy   # aplica as migrações existentes
   pnpm db:migrate                   # ao mudar o schema: cria e aplica uma nova migração
   ```

   A branch test é migrada sozinha antes de cada `pnpm test`.

5. Uma vez por ambiente, crie os templates padrão dos tenants que já existiam antes da Fatia 4
   (tenant novo já nasce com eles; se faltar, a leitura cria o padrão de qualquer forma):

   ```bash
   pnpm templates:backfill
   ```

## Rodando

Local, sem Docker para o app (precisa de um Redis em `REDIS_URL`):

```bash
pnpm dev               # http://localhost:3000
pnpm worker            # worker da fila (outro terminal)
pnpm worker:smoke      # sobe o worker, processa um job de teste e encerra (confere a conexão)
```

### Docker Compose (app, worker e Redis)

```bash
docker compose build          # uma imagem (slotz:local) para o app e o worker
docker compose up -d --wait   # sobe os três e espera os healthchecks
docker compose ps             # app, worker e redis "healthy"
docker compose down           # para (o volume redis-data guarda a fila)
```

- **`redis`**: `redis:8-alpine` só na rede interna `backend` (`internal: true`: sem porta publicada
  e sem saída para a internet), com senha (`REDIS_PASSWORD`), AOF ligado (`appendfsync everysec`)
  e `noeviction` (a fila nunca perde job por falta de memória). Dados no volume `redis-data`.
- **`app`**: `next start` na porta 3000, publicada só em `127.0.0.1:${APP_PORT:-3000}` (o acesso de
  fora vem pelo proxy reverso do deploy, ainda não feito). Healthcheck em `GET /api/health`.
- **`worker`**: `src/worker/main.ts` na mesma imagem, processo separado do Next (não importa nada
  de request, cookies ou headers; `tests/worker-boundary.test.ts` confere). Healthcheck por
  arquivo de heartbeat (`src/worker/healthcheck.ts`). `SIGTERM` termina o job em andamento e sai
  limpo (`stop_grace_period: 30s`).
- O app e o worker leem o `.env` e rodam com `NODE_ENV=production`: **`WHATSAPP_PROVIDER` e
  `EMAIL_PROVIDER` são obrigatórios**, senão o worker falha na partida (`worker_failed`) e reinicia.
  Para testar a pilha sem provedores reais, use `fake` nos dois.
- `GET /api/health` (público, sem sessão nem banco): `{"status":"ok","checks":{"redis":"up"}}`;
  Redis fora do ar responde 503 `degraded`.
- Nenhum segredo entra na imagem (`.dockerignore` exclui `.env*`): tudo vem do ambiente na hora de
  rodar. Deploy na VPS (proxy, HTTPS, domínio, backup) é pendência (ver `pendencias.md` da Fatia 4).

### Telas

| Rota                                                                                          | Quem            | O quê                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `/cadastro`, `/login`                                                                         | dono            | acesso                                                                                                 |
| `/painel`, `/painel/servicos`, `/painel/profissionais`, `/painel/profissionais/[id]/horarios` | dono            | catálogo e horários (Fatia 1)                                                                          |
| `/painel/agenda`                                                                              | dono            | agenda em dia e semana (lista no celular): agendamento manual, cancelar, remarcar, concluir, bloqueios |
| `/painel/configuracoes`                                                                       | dono            | dados do negócio (descrição, endereço, telefone) e parâmetros da agenda                                |
| `/{slug}`                                                                                     | público         | Início do site do negócio                                                                              |
| `/{slug}/servicos`, `/{slug}/equipe`                                                          | público         | serviços e profissionais ativos e vinculados                                                           |
| `/{slug}/agendar`                                                                             | público         | agendar em 4 passos: serviço, profissional (ou "qualquer"), dia e horário, dados e consentimento       |
| `/{slug}/agendamento/{token}`                                                                 | quem tem o link | ver, remarcar e cancelar o agendamento até o prazo                                                     |

Slug inexistente responde 404 já no proxy. O link de gestão aparece só na tela de confirmação
(não há envio por e-mail nem WhatsApp nesta fatia); o banco guarda só o SHA-256 do token.

### API do painel (exige sessão; o tenant vem da sessão)

| Método e rota                                                    | O quê                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET`, `PATCH /api/settings`                                     | dados do negócio e parâmetros da agenda (`PATCH` parcial)                                      |
| `GET /api/appointments?from&to[&professionalId][&status]`        | agenda por intervalo (ISO 8601 com fuso, até 62 dias)                                          |
| `POST /api/appointments`                                         | agendamento manual `{ professionalId, serviceId, startsAt, contact: { name, phone, email? } }` |
| `GET /api/appointments/{id}`                                     | um agendamento                                                                                 |
| `POST /api/appointments/{id}/cancel`, `/complete`, `/reschedule` | cancelar, concluir, remarcar `{ startsAt, professionalId? }`                                   |
| `GET`, `POST /api/time-blocks`                                   | bloqueios por intervalo; criar `{ professionalId, startsAt, endsAt, reason? }`                 |
| `GET`, `DELETE /api/time-blocks/{id}`                            | ler e remover bloqueio                                                                         |
| `GET /api/availability?serviceId&date[&professionalId]`          | horários livres do dia (`date` = `AAAA-MM-DD` no fuso do negócio)                              |

### API pública (sem sessão; o tenant vem só do slug)

Prefixo `/api/public/{slug}/`: o proxy não lê a sessão nem injeta `tenantId`, e os corpos são
estritos (campo a mais, como um `tenantId`, dá 400).

| Método e rota                                                         | O quê                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/public/{slug}`                                              | negócio, serviços e profissionais ativos e vinculados                                                                                        |
| `GET /api/public/{slug}/availability?serviceId&date[&professionalId]` | horários livres do dia, sem dados de clientes                                                                                                |
| `POST /api/public/{slug}/appointments`                                | agendar `{ serviceId, professionalId?, startsAt, contact: { name, phone, email? }, consent: true }`; devolve o token de gestão uma única vez |
| `GET /api/public/{slug}/appointments/{token}`                         | ver pelo link                                                                                                                                |
| `POST /api/public/{slug}/appointments/{token}/cancel`, `/reschedule`  | cancelar, remarcar `{ startsAt, professionalId? }`                                                                                           |

- **Limite por IP:** leitura 120 pedidos/min; escrita (agendar, cancelar, remarcar) 10 pedidos a
  cada 10 min. Acima disso, 429 com `Retry-After`. O IP vem do primeiro `x-forwarded-for`.
- **Sem vazamento do token:** API pública e página do link saem com `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` e `X-Robots-Tag: noindex` (`next.config.ts`).
- **Erros:** 404 para slug, token ou registro inexistente ou de outro negócio; 409
  `slot_unavailable` quando o horário não está mais livre; 409 `deadline_passed` depois do prazo.

## WhatsApp (Fatia 3)

### Telas

| Rota                     | Quem | O quê                                                                                                                                                      |
| ------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/painel/whatsapp`       | dono | aviso de risco de bloqueio, conectar por QR code (com expiração e renovação), status, alerta de queda ou de suspeita de bloqueio, reconectar e desconectar |
| `/painel/conversas`      | dono | conversas do negócio (contato, última mensagem, horário), 50 por página                                                                                    |
| `/painel/conversas/{id}` | dono | mensagens da conversa, 50 por página; mídia aparece só como `[imagem]`, `[áudio]` etc.                                                                     |

As telas consultam o servidor por polling (3 s com QR na tela, 15 s nos outros casos), pausam
com a aba escondida e param ao sair. As conversas são **somente leitura**: nenhuma tela envia
mensagem (resposta manual entra na Fatia 8; os envios do sistema passam pela fila da Fatia 4).

### API do painel (exige sessão; o tenant vem da sessão)

| Método e rota                                 | O quê                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/whatsapp`                           | status da conexão (`not_configured`, `qr_pending` + QR, `connected`, `disconnected`, `banned_suspected`); `live: false` quando o provedor não respondeu e o estado é o último gravado |
| `POST /api/whatsapp/connect`                  | cria a sessão e devolve o QR; já conectado → 409 `already_connected`                                                                                                                  |
| `POST /api/whatsapp/reconnect`                | QR novo na mesma sessão; sem conexão → 404; conectado → 409                                                                                                                           |
| `POST /api/whatsapp/disconnect`               | desconecta (idempotente); sem conexão → 404                                                                                                                                           |
| `GET /api/conversations?page=N`               | conversas, 50 por página, mais recente primeiro                                                                                                                                       |
| `GET /api/conversations/{id}/messages?page=N` | conversa + mensagens, 50 por página; de outro negócio ou inexistente → 404                                                                                                            |

Respostas do WhatsApp saem com `Cache-Control: no-store` (o QR dá acesso ao WhatsApp do negócio)
e nunca trazem `tenantId`, id da sessão do provedor nem id externo. Provedor fora do ar → 503
`whatsapp_unavailable` com mensagem genérica.

### Webhook do provedor

`POST {APP_BASE_URL}/api/webhooks/whatsapp` (rota fixa; ao trocar de domínio, basta atualizar a URL
no provedor). Em dev local, o provedor só alcança o webhook por um túnel com URL pública.

- **Pública no proxy:** não lê a sessão e não injeta `tenantId`. O tenant vem **só** da sessão do
  provedor gravada em `whatsapp_connections.session_id` (id aleatório, único); `tenantId` no corpo
  é ignorado.
- **Ordem:** limite por IP (600 pedidos/min, 429 com `Retry-After`) → segredo → corpo (até 256 KB).
- **Segredo:** `WHATSAPP_WEBHOOK_SECRET` no cabeçalho `x-webhook-secret` ou em
  `Authorization: Bearer <segredo>` (nunca na URL), comparado em tempo constante. Errado ou
  ausente → 401 sem alterar nada.
- **Respostas:** 200 vazio para evento processado, corpo inválido, sessão desconhecida e evento
  repetido (o provedor não reenvia); 500 vazio só em falha de banco (o provedor reenvia).
- **Idempotência:** cada evento grava um `webhook_events` (`source` + `event_id` únicos) na mesma
  transação do efeito; mensagem é única por `(tenant, id externo)`. Reenvio não duplica nada.
- **Processamento no mesmo request** (o webhook não passa pela fila; a fila da Fatia 4 é só de
  envio, e o webhook só enfileira a confirmação de opt-out).
- **Mensagem recebida:** cria ou atualiza o contato pelo telefone em E.164 (nome do perfil do
  WhatsApp ou o telefone; origem `whatsapp_inbound`, sem consentimento), a conversa (uma por
  contato) e a mensagem, e atualiza `contacts.last_inbound_at`. Mídia: só o tipo, sem baixar o arquivo.
- **Log:** uma linha JSON por chamada (`{"event":"whatsapp_webhook","outcome":...}` e contagens),
  sem conteúdo da mensagem, telefone, sessão nem segredo.

O corpo aceito hoje é o do `FakeProvider` (eventos `message`, `delivery` e `connection`, ver
`src/server/whatsapp/fake-provider.ts`). O formato real do AKG ainda é TODO (abaixo).

### Adapter

O produto fala só com a interface `WhatsAppProvider` (`src/server/whatsapp/`: `connect`,
`getStatus`, `sendText`, `disconnect`, `onInboundMessage`, `onStatusUpdate`, `handleWebhook`), que
normaliza tudo em `InboundMessage`, `DeliveryStatus` e `ConnectionStatus`. A fábrica escolhe o
provider por `WHATSAPP_PROVIDER`:

- `FakeProvider`: em memória, simula QR (vale 60 s), leitura, queda, suspeita de bloqueio,
  mensagens e status de entrega, e registra envios. Usado nos testes e no E2E.
- `AkgProvider`: **ainda não fala com o AKG.** Sem o Swagger de uma instância, nenhum endpoint
  foi inventado: toda operação responde `not_implemented` (o painel mostra provedor indisponível).
  A lista do que confirmar (autenticação, sessão, QR, status, envio, desconexão, webhook, limites)
  está no topo de `src/server/whatsapp/akg-provider.ts` (marcas `TODO(AKG)`).

Nenhum arquivo fora de `src/server/whatsapp/` referencia o AKG (`tests/whatsapp-boundary.test.ts`
faz a varredura). Trocar pela API oficial da Meta é escrever outro provider.

### Limites do WhatsApp não oficial

- A conexão usa um caminho **não oficial** (como os aparelhos conectados). O WhatsApp pode
  **bloquear o número**; a recuperação depende dele, não do Slotz. O painel avisa isso e mostra
  `banned_suspected` quando o provedor sinaliza.
- Use o número do negócio, nunca o pessoal; mantenha o celular com internet.
- Não existe disparo em massa nem campanha no produto. Todo envio do sistema passa pela fila da
  Fatia 4, com elegibilidade, intervalo aleatório, teto diário, aquecimento, opt-out e e-mail de
  reserva (seção "Fila de envio" abaixo).
- A conexão pode cair (celular sem internet, sessão encerrada no aparelho): mensagens enviadas
  nesse intervalo não chegam ao Slotz até reconectar.
- Mensagens ficam guardadas sem prazo de exclusão (pendência de LGPD registrada).

### Parâmetros da agenda (por negócio, em `/painel/configuracoes`)

| Campo                                                              | Padrão    | Faixa                  |
| ------------------------------------------------------------------ | --------- | ---------------------- |
| `slotStepMinutes`: passo da grade                                  | 15        | 5 a 120, múltiplo de 5 |
| `bufferMinutes`: intervalo entre atendimentos                      | 0         | 0 a 120, múltiplo de 5 |
| `minAdvanceMinutes`: antecedência mínima                           | 120 (2 h) | 0 a 43.200 (30 dias)   |
| `maxWindowDays`: janela máxima                                     | 60        | 1 a 365                |
| `cancelDeadlineMinutes`: prazo para o cliente cancelar ou remarcar | 120 (2 h) | 0 a 43.200             |

As faixas valem no Zod e em CHECKs no banco. Antecedência e janela valem só para o cliente; o dono
agenda sem elas. Horário livre = horário de trabalho − bloqueios − agendamentos `confirmed`
(com o buffer), na grade, no fuso do negócio (luxon; cobre virada de dia e horário de verão).

### Slugs reservados

Tenants não podem usar estes slugs, porque o site público divide a raiz com o app (lista em
`src/server/auth/reserved-slugs.ts`):

`api`, `b`, `cadastro`, `login`, `logout`, `painel`, `fonts`, `favicon`, `robots`, `sitemap`,
`manifest`, `next`, `static`, `assets`, `public`, `admin`, `agenda`, `agendamento`, `agendar`,
`ajuda`, `app`, `auth`, `blog`, `configuracoes`, `conta`, `contato`, `docs`, `entrar`, `health`,
`planos`, `precos`, `privacidade`, `sair`, `sobre`, `status`, `suporte`, `termos`, `webhooks`,
`www`, `algoritmi`, `slotz`.

O cadastro pula um slug reservado (um negócio chamado "Login" ganha outro slug), e a migração
`20261010035347_agenda_link_publico` renomeou tenants antigos que os usavam. Ao acrescentar um
nome à lista, crie uma migração que renomeie quem já o usa.

O cookie de sessão é `__Host-slotz_session` (host-only, HttpOnly, Secure, SameSite=Lax). Em
`http://localhost` o Chrome e o Firefox aceitam cookie Secure; fora de localhost, use HTTPS.

## Fila de envio, limites e elegibilidade (Fatia 4)

Nenhuma mensagem do sistema sai direto: tudo entra por `enqueueMessage`
(`src/server/outbound/enqueue.ts`) e só o worker envia, pelo `sendText` do adapter ou pelo
`EmailProvider`. A elegibilidade e a política rodam no worker **antes de cada tentativa**, não só ao
enfileirar. `tests/outbound-send-boundary.test.ts` falha se algum código fora do worker (e do
próprio adapter) chamar `sendText`.

### `enqueueMessage`

```ts
enqueueMessage({ tenantId, contactId, messageType, idempotencyKey, scheduledFor?, appointmentId? })
// → { status: "queued" | "duplicate" | "failed" | "rejected", ... }  ("rejected": contato não existe no tenant)
```

- `messageType` vem de lista fechada (`src/server/outbound/message-types.ts`, igual ao CHECK do
  banco): hoje `appointment_confirmation` e `optout_confirmation`. Não há tipo livre nem campanha.
- O job no Redis leva só ids e a chave; o texto é montado no worker a partir do template.
- **Idempotência:** `idempotencyKey` é única por tenant em `outbound_messages` (ex.:
  `appointment_confirmation:<appointmentId>`). O mesmo evento devolve `duplicate` e nunca sai duas vezes.
- **Redis fora do ar:** a linha vira `failed` (visível no registro), quem chamou segue normalmente
  (o agendamento não é afetado) e nada é lançado.
- Cada envio fica em `outbound_messages` (tenant, contato, tipo, canal `whatsapp|email`, status
  `queued|sent|failed|blocked|expired`, motivo do bloqueio, id externo, horários), sem o texto. O
  envio por WhatsApp também aparece na conversa (`messages`, `direction=outbound`).

### Elegibilidade (proativo)

`isContactEligibleForProactive` (`src/server/outbound/eligibility.ts`). Elegível se:

| Regra | Condição                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| (a)   | escreveu nos últimos 30 dias (`contacts.last_inbound_at`, 30 dias exatos ainda vale)                                               |
| (b)   | tem agendamento `confirmed` (cancelado e concluído não contam), plano ou cobrança ativa (plano e cobrança entram nas Fatias 6 e 7) |
| (c)   | foi cadastrado com consentimento registrado (`contacts.consent_at`)                                                                |

`opt_out` vence as três regras. Inelegível vira `blocked` com o motivo (`not_eligible`, `opt_out`,
`contact_not_found`, …) e nunca é enviado nem gasta o teto. O contato é sempre lido com o tenant do job.

### Política de envio por número

Constantes em `src/server/outbound/send-policy.ts` (função pura, sem Redis):

| Item                                                                        | Valor                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Intervalo entre mensagens do mesmo número                                   | aleatório, 8 a 25 s                                                                                  |
| Teto diário (número maduro)                                                 | 200                                                                                                  |
| Aquecimento (dias desde a primeira conexão `connected`; reconexão não zera) | dias 1-2: 20 · 3-4: 40 · 5-6: 80 · 7-8: 120 · 9-10: 160 · 11+: 200; fase de aquecimento até o dia 14 |
| Teto manual (`whatsapp_connections.daily_send_limit`)                       | opcional, nulo por padrão; só reduz o limite, nunca aumenta                                          |
| Virada do dia                                                               | meia-noite no fuso do tenant                                                                         |
| Janela de envio                                                             | 8h às 20h no fuso do tenant; fora dela espera. Exceção: confirmação de agendamento                   |
| Teto atingido                                                               | adia para o dia seguinte (confirmação de agendamento primeiro, depois ordem de chegada)              |
| Expiração                                                                   | mais de 24 h de atraso vira `expired`                                                                |
| Retentativa                                                                 | 3, com espera de 1, 5 e 15 min; falha final fica `failed` e devolve a vaga do teto                   |

O contador diário é atômico no SQL (`whatsapp_connections.daily_sent_count`): dois workers nunca
passam do teto. A fila tem concorrência por tenant: um número no intervalo não trava os outros.

### Opt-out

No webhook (`src/server/messaging/opt-out.ts`), quando a mensagem **inteira** (sem diferenciar
maiúscula, acento ou espaço nas pontas) é `SAIR`, `PARAR`, `CANCELAR` ou `STOP`:

- `contacts.opt_out` é gravado na hora, na transação do webhook; envios proativos já na fila viram
  `blocked`/`opt_out`.
- Sai **uma única** confirmação (`optout_confirmation`), pela mesma fila e contando no teto; o
  marcador `opt_out_confirmation_sent_at` impede repetir, mesmo com webhook repetido ou novo `SAIR`.
- Frase com a palavra no meio ("quero sair da lista") não conta. Pontuação também não ("Sair.").
- `VOLTAR` reativa (proativos voltam a sair, sem nova confirmação). Reativação pelo dono na tela
  ainda não existe.

### E-mail de reserva

Com a conexão `disconnected`, `banned_suspected` ou inexistente, o worker envia por e-mail
(`src/server/email/`: interface `EmailProvider`, `FakeEmailProvider` e `ResendEmailProvider`, escolhido por
`EMAIL_PROVIDER`). O e-mail não gasta o teto do WhatsApp e não entra na conversa. Contato sem
e-mail fica `blocked` com `no_channel`, sem nova tentativa. Opt-out e elegibilidade valem igual no
e-mail. Remetente: `nao-responda@{EMAIL_FROM_DOMAIN}`. Logs do worker não levam e-mail, telefone
nem texto.

### Templates

Cada tenant tem um template por tipo (`message_templates`), criado com o texto padrão do código
(`src/server/outbound/templates.ts`). O dono edita de 3 a 10 variações (até 1.000 caracteres cada)
com variáveis por tipo: `appointment_confirmation` aceita `{{nome}}`, `{{negocio}}`, `{{servico}}`,
`{{profissional}}`, `{{data}}` e `{{hora}}`; `optout_confirmation`, `{{nome}}` e `{{negocio}}`.
Variável desconhecida ou texto vazio é recusado. O worker sorteia uma variação sem repetir a última
usada para o mesmo contato. O texto é sempre texto puro (nunca HTML).

### Telas

| Rota                | Quem | O quê                                                                                                             |
| ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| `/painel/whatsapp`  | dono | bloco só leitura: uso de hoje ("42 de 200"), fase do aquecimento e envios bloqueados com o motivo (50 por página) |
| `/painel/mensagens` | dono | templates por tipo: editar variações, pré-visualizar como texto puro, restaurar o padrão (com "Desfazer")         |

### API do painel (exige sessão; o tenant vem da sessão)

| Método e rota                              | O quê                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `GET /api/whatsapp/usage`                  | uso do dia, limite efetivo e fase do aquecimento; sem conexão, `configured: false` |
| `GET /api/whatsapp/blocked?page=N`         | envios bloqueados com o motivo, 50 por página                                      |
| `GET /api/message-templates`               | um template por tipo da lista fechada                                              |
| `GET`, `PATCH /api/message-templates/{id}` | ler; trocar as variações `{ variations }` (inválido → 400 `invalid_template`)      |
| `POST /api/message-templates/{id}/restore` | voltar ao texto padrão                                                             |

Não há criação nem exclusão de template (o tipo é do sistema) e nenhuma rota aceita `tenantId` do cliente.

## Testes e checagens

| Comando                                  | O que faz                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm lint`                              | ESLint                                                                                                |
| `pnpm typecheck`                         | Tipos de rota do Next + `tsc --noEmit`                                                                |
| `pnpm check:tenant-access`               | Falha se algum código fora de `src/server/repositories/` acessar o banco direto                       |
| `pnpm test`                              | Vitest contra a branch test e o Redis de teste (isolamento de tenant, auth, validação, fila e worker) |
| `pnpm redis:test:up` / `redis:test:down` | Sobe e derruba o Redis dos testes de integração (`docker-compose.test.yml`, porta 6380 em 127.0.0.1)  |
| `pnpm build`                             | Build de produção                                                                                     |
| `docker compose build`                   | Imagem do app e do worker                                                                             |
| `pnpm test:e2e`                          | Playwright em desktop e mobile; sobe `next start` na porta 3100 contra a branch test                  |

Antes do `pnpm test`, suba o Redis de teste (`pnpm redis:test:up`). O E2E usa o build: rode `pnpm build` antes. Na primeira vez, instale o navegador:

```bash
pnpm exec playwright install chromium
```

O E2E grava prints em `docs/features/<fatia>/evidencias/` (reescreve os das fases anteriores) e,
no fim, apaga da branch test só as contas que ele criou (e-mails `e2e-telas-*@teste.slotz.dev`).

## Regras que o código garante

- **Isolamento por tenant:** todo acesso a dados de negócio passa por
  `createTenantRepository(tenantId)` em `src/server/repositories/tenant-repository.ts` (módulos
  por domínio em `src/server/repositories/tenant/`), que embute o `tenantId` em toda query. O
  proxy (`src/proxy.ts`) injeta o `tenantId` da sessão e descarta cabeçalhos forjados. Registros
  de outro tenant respondem 404, como se não existissem. O site público usa
  `createPublicRepository()`, que resolve o tenant pelo slug e expõe só campos públicos. O webhook do WhatsApp usa `createWhatsAppWebhookRepository`
  (`src/server/repositories/whatsapp-webhook-repository.ts`), que resolve o tenant só pela sessão do
  provedor.
- **Sem sobreposição:** dois agendamentos `confirmed` do mesmo profissional não se sobrepõem
  (EXCLUDE gist com `btree_gist` no banco); a violação vira 409 na API.
- **Cliente final (contato, tabela `contacts`):** nome e telefone obrigatórios, telefone normalizado
  em E.164 por `normalizePhone` (`src/lib/phone.ts`: `+5511987654321`; sem DDI assume 55; número de
  fora do Brasil com `+`) e usado para reencontrar o contato; consentimento LGPD registrado com
  origem e data.
- **Sessão no banco:** o cookie leva um token aleatório; o banco guarda só o SHA-256. Vale
  30 dias com renovação deslizante; logout apaga a sessão.
- **Senha:** argon2, mínimo de 8 caracteres; limite de tentativas por e-mail e por IP; erro de
  login genérico.
- **Dinheiro em centavos inteiros**, datas em UTC, fuso padrão `America/Sao_Paulo`.
- **Erros da API** no formato `{ "error": { "code", "message" } }`.

## Estrutura

```
prisma/                      schema e migrações
src/app/                     telas e route handlers (src/app/api)
src/app/[slug]/              site público do negócio
src/components/              UI (auth, painel, site, shadcn/ui)
src/server/agenda/           horários livres (função pura) e regras de agendar e remarcar
src/server/auth/             sessão, senha, limite de tentativas, slugs reservados
src/server/email/            adapter de e-mail (interface, FakeEmailProvider, ResendEmailProvider, fábrica)
src/server/http/             helpers de rota (painel, pública, limite por IP, segredo do webhook)
src/server/messaging/        conexão do WhatsApp, webhook e opt-out (usa só o adapter)
src/server/outbound/         enqueueMessage, elegibilidade, política de envio, templates e worker de envio
src/server/public-site/      carga do site público
src/server/queue/            conexão com o Redis e fila de sistema (BullMQ)
src/server/repositories/     único ponto de acesso ao banco
src/server/validation/       schemas Zod
src/server/whatsapp/         adapter do WhatsApp (interface, FakeProvider, AkgProvider, fábrica)
src/worker/                  entrada do worker (main, healthcheck, heartbeat)
src/lib/phone.ts             normalização de telefone em E.164 (servidor e navegador)
tests/                       Vitest
e2e/                         Playwright
scripts/                     checagens (db:check, check:tenant-access) e templates:backfill
```
