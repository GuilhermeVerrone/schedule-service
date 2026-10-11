# Slotz

Assistente de atendimento, agenda e cobrança para pequenos negócios. Este repositório tem:

- **Fatia 1** (`base-auth-tenant-servicos`): cadastro e login do dono, tenant isolado,
  profissionais, serviços e horários de trabalho.
- **Fatia 2** (`agenda-link-publico`): agenda do painel, configurações do negócio e site público
  do negócio em `/{slug}` com agendamento sem login e link de gestão do agendamento.

Documentação por fatia em `docs/features/<slug>/` (guia, decisões, impacto, plano, pendências e
evidências por fase). Contexto do produto: `prompt-guide.md`.

## Stack

- Next.js 16 (App Router) + TypeScript, API em route handlers, validação com Zod
- Prisma 7 + Postgres no Neon (adapter `pg`)
- Tailwind 4 + shadcn/ui, tema com os tokens do design system da Algoritmi
- Vitest (unidade, repositório e API) e Playwright (telas)

## Pré-requisitos

- Node.js 24 e pnpm 10 (`corepack enable` usa a versão do `packageManager`)
- Um projeto Postgres no Neon com duas branches: **dev** (app local) e **test** (testes).
  Os testes apagam e criam dados: nunca aponte `TEST_*` para a branch dev ou produção.

## Configuração

1. Instale as dependências (o `postinstall` gera o client do Prisma em `src/generated/`):

   ```bash
   pnpm install
   ```

2. Copie `.env.example` para `.env` e preencha. O `.env` está no `.gitignore`; nunca o versione.

   | Variável | Para quê |
   |---|---|
   | `DATABASE_URL` | Branch dev, conexão pooled (app) |
   | `DIRECT_URL` | Branch dev, conexão direta (migrações do Prisma) |
   | `TEST_DATABASE_URL` | Branch test, conexão pooled (Vitest e servidor do E2E) |
   | `TEST_DIRECT_URL` | Branch test, conexão direta (migração antes da suíte) |
   | `APP_BASE_URL` | URL base do app, ex.: `http://localhost:3000` |
   | `PUBLIC_BOOKING_BASE_URL` | Base do link público de agendamento (fatias futuras) |
   | `EMAIL_FROM_DOMAIN` | Domínio de envio de e-mail (fatias futuras) |

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

## Rodando

```bash
pnpm dev     # http://localhost:3000
```

### Telas

| Rota | Quem | O quê |
|---|---|---|
| `/cadastro`, `/login` | dono | acesso |
| `/painel`, `/painel/servicos`, `/painel/profissionais`, `/painel/profissionais/[id]/horarios` | dono | catálogo e horários (Fatia 1) |
| `/painel/agenda` | dono | agenda em dia e semana (lista no celular): agendamento manual, cancelar, remarcar, concluir, bloqueios |
| `/painel/configuracoes` | dono | dados do negócio (descrição, endereço, telefone) e parâmetros da agenda |
| `/{slug}` | público | Início do site do negócio |
| `/{slug}/servicos`, `/{slug}/equipe` | público | serviços e profissionais ativos e vinculados |
| `/{slug}/agendar` | público | agendar em 4 passos: serviço, profissional (ou "qualquer"), dia e horário, dados e consentimento |
| `/{slug}/agendamento/{token}` | quem tem o link | ver, remarcar e cancelar o agendamento até o prazo |

Slug inexistente responde 404 já no proxy. O link de gestão aparece só na tela de confirmação
(não há envio por e-mail nem WhatsApp nesta fatia); o banco guarda só o SHA-256 do token.

### API do painel (exige sessão; o tenant vem da sessão)

| Método e rota | O quê |
|---|---|
| `GET`, `PATCH /api/settings` | dados do negócio e parâmetros da agenda (`PATCH` parcial) |
| `GET /api/appointments?from&to[&professionalId][&status]` | agenda por intervalo (ISO 8601 com fuso, até 62 dias) |
| `POST /api/appointments` | agendamento manual `{ professionalId, serviceId, startsAt, customer: { name, phone, email? } }` |
| `GET /api/appointments/{id}` | um agendamento |
| `POST /api/appointments/{id}/cancel`, `/complete`, `/reschedule` | cancelar, concluir, remarcar `{ startsAt, professionalId? }` |
| `GET`, `POST /api/time-blocks` | bloqueios por intervalo; criar `{ professionalId, startsAt, endsAt, reason? }` |
| `GET`, `DELETE /api/time-blocks/{id}` | ler e remover bloqueio |
| `GET /api/availability?serviceId&date[&professionalId]` | horários livres do dia (`date` = `AAAA-MM-DD` no fuso do negócio) |

### API pública (sem sessão; o tenant vem só do slug)

Prefixo `/api/public/{slug}/`: o proxy não lê a sessão nem injeta `tenantId`, e os corpos são
estritos (campo a mais, como um `tenantId`, dá 400).

| Método e rota | O quê |
|---|---|
| `GET /api/public/{slug}` | negócio, serviços e profissionais ativos e vinculados |
| `GET /api/public/{slug}/availability?serviceId&date[&professionalId]` | horários livres do dia, sem dados de clientes |
| `POST /api/public/{slug}/appointments` | agendar `{ serviceId, professionalId?, startsAt, customer: { name, phone, email? }, consent: true }`; devolve o token de gestão uma única vez |
| `GET /api/public/{slug}/appointments/{token}` | ver pelo link |
| `POST /api/public/{slug}/appointments/{token}/cancel`, `/reschedule` | cancelar, remarcar `{ startsAt, professionalId? }` |

- **Limite por IP:** leitura 120 pedidos/min; escrita (agendar, cancelar, remarcar) 10 pedidos a
  cada 10 min. Acima disso, 429 com `Retry-After`. O IP vem do primeiro `x-forwarded-for`.
- **Sem vazamento do token:** API pública e página do link saem com `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` e `X-Robots-Tag: noindex` (`next.config.ts`).
- **Erros:** 404 para slug, token ou registro inexistente ou de outro negócio; 409
  `slot_unavailable` quando o horário não está mais livre; 409 `deadline_passed` depois do prazo.

### Parâmetros da agenda (por negócio, em `/painel/configuracoes`)

| Campo | Padrão | Faixa |
|---|---|---|
| `slotStepMinutes`: passo da grade | 15 | 5 a 120, múltiplo de 5 |
| `bufferMinutes`: intervalo entre atendimentos | 0 | 0 a 120, múltiplo de 5 |
| `minAdvanceMinutes`: antecedência mínima | 120 (2 h) | 0 a 43.200 (30 dias) |
| `maxWindowDays`: janela máxima | 60 | 1 a 365 |
| `cancelDeadlineMinutes`: prazo para o cliente cancelar ou remarcar | 120 (2 h) | 0 a 43.200 |

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

## Testes e checagens

| Comando | O que faz |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Tipos de rota do Next + `tsc --noEmit` |
| `pnpm check:tenant-access` | Falha se algum código fora de `src/server/repositories/` acessar o banco direto |
| `pnpm test` | Vitest contra a branch test (isolamento de tenant no repositório e na API, auth, validação) |
| `pnpm build` | Build de produção |
| `pnpm test:e2e` | Playwright em desktop e mobile; sobe `next start` na porta 3100 contra a branch test |

O E2E usa o build: rode `pnpm build` antes. Na primeira vez, instale o navegador:

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
  `createPublicRepository()`, que resolve o tenant pelo slug e expõe só campos públicos.
- **Sem sobreposição:** dois agendamentos `confirmed` do mesmo profissional não se sobrepõem
  (EXCLUDE gist com `btree_gist` no banco); a violação vira 409 na API.
- **Cliente final:** nome e telefone obrigatórios, telefone normalizado (dígitos com DDI 55) e
  usado para reencontrar o cliente; consentimento LGPD registrado com origem e data.
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
src/server/http/             helpers de rota (painel, pública, limite por IP)
src/server/public-site/      carga do site público
src/server/repositories/     único ponto de acesso ao banco
src/server/validation/       schemas Zod
tests/                       Vitest
e2e/                         Playwright
scripts/                     checagens (db:check, check:tenant-access)
```
