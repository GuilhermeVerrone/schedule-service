# Pendências: Agenda e link público

Registradas no fechamento (Fase 10, 2026-10-10), a partir das evidências das Fases 1 a 9. Nada aqui foi implementado nesta fatia.

## Fora da fatia por decisão
| # | Pendência | Para onde vai | Ref |
|---|-----------|---------------|-----|
| 1 | **Exclusão de dados do cliente final (LGPD).** Não há rota nem tela para apagar ou anonimizar um Customer (nome, telefone, e-mail) a pedido dele. Hoje só apagar o tenant leva os clientes em cascata. Precisa decidir: anonimizar mantendo o histórico do agendamento, ou apagar; quem pede (o dono no painel, a partir do contato do cliente); prazo. | Fatia própria ou junto da exclusão de conta do dono (já anotada na Fatia 1) | impacto (LGPD), prompt-guide "permitir exclusão de dados" |
| 2 | **WhatsApp (envio do link de gestão, confirmação, lembretes).** Nesta fatia o link aparece só na tela de confirmação; quem o perde fala com o negócio. A implementação real é na Fatia 3 (adapter WA-AKG, QR code), sempre pelo adapter. | Fatia 3 (`docs/features/whatsapp-conexao-mensagens/`) | D7, guia 8 |
| 3 | **Agendamento `confirmed` como "agendamento ativo"** na regra de contato elegível. | Fatia 4 | D10 |
| 4 | **Consentimento LGPD no agendamento manual do dono**: o cliente criado no painel não tem consentimento registrado; só fica elegível enquanto tiver agendamento `confirmed`. Decidir se o painel ganha o checkbox. | Fatia 4 | D5, D10 |
| 5 | E-mail transacional, lembretes, fila de envio. | Fatias 3 a 9 | guia 8 |

## Técnicas (achadas nas fases, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 6 | **Buffer sob corrida**: a EXCLUDE barra sobreposição, não o buffer. Dois pedidos simultâneos em horários encostados podem passar os dois. Opções: `pg_advisory_xact_lock` por profissional em volta da checagem e da gravação, ou aceitar o risco. | Fases 3, 4, 5 |
| 7 | **Cliente órfão**: no público, o cliente é criado antes do agendamento; quem perde a corrida (409) fica sem agendamento. | Fases 4, 5 |
| 8 | **Faxina de `rate_limit_hits` e `login_attempts`**: sem job; IPs que não voltam deixam linhas antigas (índice em `created_at` já existe). | Fases 1, 5 |
| 9 | **IP atrás de proxy**: `clientIp` confia no primeiro `x-forwarded-for`. Na hospedagem final, confirmar que vem do proxy confiável. | Fase 5 |
| 10 | **Token em log de acesso**: o token vai no caminho da API pública; configurar a hospedagem para não logar `/api/public/*/appointments/*`. | Fase 5 |
| 11 | **Slugs reservados novos** exigem migração que renomeie quem já usa o nome. | Fase 1 |
| 12 | `customers.update` com telefone de outro cliente do tenant sobe P2002 sem tratamento (não há rota de edição de cliente ainda). | Fase 2 |
| 13 | `.vitest/json/output.json` está versionado e é reescrito pelo RTK; avaliar tirar do Git. | Fase 2 |
| 14 | Aviso do `pg` "client.query() when the client is already executing a query" em todas as suítes (adapter Prisma). | Fase 5 |
| 15 | O link de gestão na confirmação usa a origem do navegador; `PUBLIC_BOOKING_BASE_URL` ainda não é usado. Avaliar ao migrar de domínio (links precisam sobreviver com 301). | Fases 6, 9 |

## Produto e telas (melhorias, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 16 | Nome do negócio (e slug, fuso) não é editável no painel; é decisão nova (mexe no link público). | Fase 6 |
| 17 | "Restaurar padrões" da agenda não existe. | Fase 6 |
| 18 | Menu mobile do painel com 5 itens: "Configurações" fica fora da área visível até rolar. | Fases 6, 7 |
| 19 | Horários do painel (`GET /api/availability`) seguem antecedência e janela do cliente; falta um modo do dono. | Fase 7 |
| 20 | Remarcar para outro profissional: a API aceita, mas mantém a duração gravada; a tela do painel não oferece a troca. | Fases 4, 7 |
| 21 | Bloqueio de vários dias exige um bloqueio por dia na tela; não há edição de bloqueio (`PATCH`). | Fases 4, 7 |
| 22 | Data e visão da agenda não vão para a URL. | Fase 7 |
| 23 | Remarcar pelo link não mostra horários que só colidem com o próprio agendamento, nem oferece "qualquer profissional". | Fase 9 |
| 24 | Início do site sem botão "Agendar"; serviços não levam ao agendar com o serviço escolhido. | Fase 9 |
| 25 | Página de link inválido responde 200 (a API responde 404). | Fase 9 |
