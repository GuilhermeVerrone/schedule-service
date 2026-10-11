# Plano: agenda-link-publico (aprovado em 2026-10-10)

Um chat novo por fase. Refs: guia (itens 1-9) e decisões (D1-D11). Pré-requisito de toda fase: `pnpm lint`, `pnpm typecheck`, `pnpm check:tenant-access` e `pnpm test` verdes ao terminar.

## Fase 1: Schema, migração e slugs reservados
- Escopo: modelos Customer, Appointment (status `confirmed|canceled|completed`, hash do token de gestão) e TimeBlock; colunas novas em Tenant (descrição, endereço, telefone, 5 parâmetros da agenda com padrões e CHECKs); FKs compostas (tenant_id, id); EXCLUDE gist em appointments (profissional + intervalo, só `confirmed`) e índices; lista de slugs reservados, validação no cadastro e migração que renomeia tenants existentes com slug reservado; limite de requisições público (generalizar `login_attempts` ou tabela própria); migrações em dev e test.
- Fora: repositórios, API, telas, cálculo de horários.
- Pronto quando: migração aplica nas duas branches; teste de SQL direto prova que a constraint recusa sobreposição `confirmed` do mesmo profissional, aceita `canceled` sobreposto e aceita profissionais diferentes; cadastro com nome "Login" gera slug diferente de `login`; `check-tenant-access` continua verde.
- Refs: guia 5, 6; D1, D3, D4, D8, D11.

## Fase 2: Repositórios
- Escopo: separar `tenant-repository.ts` por domínio sem mudar comportamento; acrescentar Customer, Appointment, TimeBlock e configurações da agenda, todos com tenantId embutido; repositório público que resolve o tenant por slug e expõe só campos públicos (negócio, serviços e profissionais ativos e vinculados).
- Fora: cálculo de horários, API, telas.
- Pronto quando: testes de repositório provam isolamento (inclusive por ID) nas tabelas novas; o repositório público nunca devolve dado de outro tenant nem arquivado; a violação da constraint vira erro tipado de conflito.
- Refs: guia 5, 6; D1, D5, D8.

## Fase 3: Cálculo de horários livres
- Escopo: função pura que recebe horários de trabalho, bloqueios, agendamentos `confirmed`, duração do serviço, parâmetros e fuso do tenant e devolve os horários livres de um dia (e de uma janela); modo "qualquer profissional".
- Fora: banco, rotas, telas.
- Pronto quando: testes cobrem duração, buffer, passo da grade, antecedência mínima, janela máxima, bloqueio atravessando o serviço, agendamento existente, virada de dia, fuso diferente de São Paulo e transição de horário de verão simulada com fuso que a tenha.
- Refs: guia 6, 9; D3, D4, D11.

## Fase 4: API do painel (agenda, bloqueios e configurações)
- Escopo: rotas autenticadas para ler e salvar dados e parâmetros do negócio; listar agenda por intervalo; criar agendamento manual; cancelar, remarcar e concluir; CRUD de bloqueios; validação Zod e erro padrão; conflito responde 409.
- Fora: rotas públicas, telas.
- Pronto quando: testes de API cobrem CRUD, casos inválidos, concorrência (dois pedidos simultâneos, um só vence) e provam que o tenant A é negado em todas as rotas do B e sem sessão; mudar parâmetros altera os horários calculados.
- Refs: guia 5, 6, 7d, 7e, 9; D3, D4, D8, D9.

## Fase 5: API pública
- Escopo: prefixo público no `proxy.ts`; rotas por slug: dados do site, disponibilidade por dia, criar agendamento (cliente por telefone normalizado, consentimento, token de gestão devolvido uma vez), ver, cancelar e remarcar pelo token dentro do prazo; limite de requisições por IP; cabeçalhos contra vazamento do token.
- Fora: telas.
- Pronto quando: testes cobrem fluxo completo, slug inexistente (404), token inválido, prazo vencido, rate limit, concorrência entre dois clientes, disponibilidade sem expor dados de clientes, e que nenhuma rota pública aceita tenantId do cliente.
- Refs: guia 6, 7a, 7b, 7c, 7f, 9; D1, D5, D6, D7, D8, D10.

## Fase 6: Tela de configurações
- Escopo: `/painel/configuracoes` com dados do negócio e os 5 parâmetros; item no menu do painel; estados vazio/carregando/erro; mobile-first.
- Fora: agenda, site público.
- Pronto quando: fluxo no navegador (Playwright) com prints mobile e desktop, fiel ao DESIGN.md da Algoritmi.
- Refs: guia 3, 7e; D2, D3.

## Fase 7: Tela de agenda do painel
- Escopo: `/painel/agenda` com visão de dia e semana (lista no celular), criar agendamento manual, cancelar, remarcar, concluir, criar e remover bloqueios.
- Fora: site público.
- Pronto quando: fluxo completo no navegador (Playwright) com prints mobile e desktop, fiel ao DESIGN.md; conflito de horário aparece como erro claro.
- Refs: guia 3, 7d; D4, D9.

## Fase 8: Site público: layout, Início, Serviços e Equipe
- Escopo: layout público em `/{slug}` com menu e rotas Início, Serviços e Equipe; 404 por slug; estados vazios (sem serviços ou profissionais ativos); metadados.
- Fora: fluxo de agendar e gestão pelo token.
- Pronto quando: Playwright confirma navegação pelo menu em mobile e desktop com prints; `/login`, `/cadastro` e `/painel` continuam funcionando; slug inexistente mostra 404.
- Refs: guia 3, 7a, 7f; D1, D2.

## Fase 9: Site público: Agendar e gestão do agendamento
- Escopo: fluxo em passos (serviço, profissional ou "qualquer", dia e horário, dados e consentimento, confirmação com o link de gestão); página `/{slug}/agendamento/{token}` para ver, cancelar e remarcar; tratamento de 409 recarregando horários.
- Fora: notificações por qualquer canal.
- Pronto quando: Playwright cobre agendar, cancelar e remarcar em mobile e desktop com prints, e dois clientes disputando o mesmo horário (um confirma, outro vê erro e horários atualizados).
- Refs: guia 6, 7a, 7b, 7c; D5, D6, D8.

## Fase 10: Fechamento
- Escopo: revisão contra o "pronto" do guia; README (rotas novas, parâmetros, slugs reservados); varredura de segredos; suíte completa e `pnpm build`; pendências registradas (exclusão de dados do cliente, WhatsApp na Fatia 3).
- Fora: funcionalidade nova.
- Pronto quando: cada item de "pronto" do guia tem evidência; `pnpm lint`, `typecheck`, `check:tenant-access`, `test`, `build` e `test:e2e` passam.
- Refs: guia 9; D1-D11.

## Progresso
- [x] Fase 1  - [x] Fase 2  - [x] Fase 3  - [x] Fase 4  - [x] Fase 5  - [x] Fase 6  - [x] Fase 7  - [x] Fase 8  - [x] Fase 9  - [x] Fase 10
