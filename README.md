# Slotz

Assistente de atendimento, agenda e cobrança para pequenos negócios. Este repositório tem a
Fatia 1 (`base-auth-tenant-servicos`): cadastro e login do dono, tenant isolado, profissionais,
serviços e horários de trabalho.

Documentação da fatia: `docs/features/base-auth-tenant-servicos/` (guia, decisões, plano e
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

Rotas: `/cadastro`, `/login`, `/painel`, `/painel/servicos`, `/painel/profissionais`,
`/painel/profissionais/[id]/horarios`.

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

O E2E grava prints em `docs/features/base-auth-tenant-servicos/evidencias/` e, no fim, apaga
da branch test só as contas que ele criou (e-mails `e2e-telas-*@teste.slotz.dev`).

## Regras que o código garante

- **Isolamento por tenant:** todo acesso a dados de negócio passa por
  `createTenantRepository(tenantId)` em `src/server/repositories/tenant-repository.ts`, que
  embute o `tenantId` em toda query. O proxy (`src/proxy.ts`) injeta o `tenantId` da sessão e
  descarta cabeçalhos forjados. Registros de outro tenant respondem 404, como se não existissem.
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
src/components/              UI (auth, painel, shadcn/ui)
src/server/auth/             sessão, senha, limite de tentativas, contexto do tenant
src/server/repositories/     único ponto de acesso ao banco
src/server/validation/       schemas Zod
tests/                       Vitest
e2e/                         Playwright
scripts/                     checagens (db:check, check:tenant-access)
```
