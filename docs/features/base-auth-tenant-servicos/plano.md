# Plano: base-auth-tenant-servicos (aprovado em 2026-10-08)

Um chat novo por fase. Refs: guia (itens 1-9) e decisões (D1-D7).

## Fase 1: Fundação
- Escopo: git init e .gitignore; projeto Neon "slotz" com branches dev e test; esqueleto Next.js + TypeScript + pnpm + Tailwind + shadcn/ui + Prisma + Vitest; tema com os tokens do design system da Algoritmi (`../algoritmi/DESIGN.md`: cores, Poppins e Manrope, raios, alturas de controle) em Tailwind e nas variáveis do shadcn/ui; .env e .env.example; página inicial mínima já no padrão visual.
- Fora: tabelas de negócio, auth, telas.
- Pronto quando: `pnpm build` e `pnpm test` passam; Prisma conecta nas duas branches; .env fora do Git; a página inicial renderiza com as fontes e cores da Algoritmi (print).
- Refs: guia 3, 6; D2, D7, D8.

## Fase 2: Schema e repositório
- Escopo: schema Prisma (Tenant, User, Session, LoginAttempt, Professional, Service, ProfessionalService, WorkingHours), índices, primeira migração; repositório que só se constrói com tenantId; validação Zod de horários; checagem contra `prisma.<modelo>` fora do repositório.
- Fora: auth, API, telas.
- Pronto quando: testes de isolamento no repositório passam (inclusive por ID); a checagem de acesso direto falha de propósito em um caso de teste.
- Refs: guia 5, 6, 9; D2-D6.

## Fase 3: Autenticação
- Escopo: cadastro (transação, slug), login, logout, sessão no banco, cookie, limite de tentativas, middleware que injeta tenantId; rotas /api/auth/*.
- Fora: CRUD, telas, e-mail, recuperação de senha.
- Pronto quando: testes cobrem cadastro, login, logout, senha fraca, e-mail duplicado, bloqueio por tentativas, erro genérico e flags do cookie.
- Refs: guia 6, 7a, 7b; D1, D3, D4, premissas a-e.

## Fase 4: API de profissionais, serviços e horários
- Escopo: CRUD com Zod e erro padrão; arquivar; vínculo N:N; CRUD de horários.
- Fora: telas.
- Pronto quando: testes de API cobrem CRUD e casos inválidos e provam que o tenant A é negado em todas as rotas do B, inclusive sem sessão.
- Refs: guia 5, 6, 7c, 7d, 9; D4-D7.

## Fase 5: Telas de acesso e painel
- Escopo: /cadastro, /login, layout do /painel, navegação, logout, proteção de rota, estados e Sonner.
- Fora: telas de profissionais, serviços, horários.
- Pronto quando: fluxo cadastro/login/logout funciona no navegador (Playwright), com prints mobile e desktop, fiel ao DESIGN.md da Algoritmi.
- Refs: guia 3, 7a, 7b; D7, D8.

## Fase 6: Telas de profissionais, serviços e horários
- Escopo: as três telas com criar, editar, arquivar, vincular; estados vazio/carregando/erro; mobile-first.
- Fora: agenda.
- Pronto quando: fluxo completo no navegador (Playwright) com prints mobile e desktop, fiel ao DESIGN.md da Algoritmi.
- Refs: guia 3, 7c; D5-D8.

## Fase 7: Fechamento
- Escopo: suíte completa, revisão de segredos, README de setup, confirmar cada item de "pronto" do guia com evidência.
- Pronto quando: os 5 itens do "pronto" têm evidência e pendências estão listadas.

## Progresso
- [x] Fase 1  - [x] Fase 2  - [x] Fase 3  - [x] Fase 4  - [x] Fase 5  - [x] Fase 6  - [x] Fase 7
