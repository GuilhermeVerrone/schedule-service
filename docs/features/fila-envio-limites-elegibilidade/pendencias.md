# Pendências: Fila de envio, limites e elegibilidade

Registradas no fechamento (Fase 12, 2026-10-11), a partir das evidências das Fases 1 a 11. Nada aqui foi implementado nesta fatia.

## Fora da fatia por decisão ou premissa
| # | Pendência | Para onde vai | Ref |
|---|-----------|---------------|-----|
| 1 | **Deploy na VPS.** Proxy reverso, HTTPS, domínio (`APP_BASE_URL` etc.), backup do volume `redis-data`, CI/CD, `WHATSAPP_PROVIDER`/`EMAIL_PROVIDER` e segredos de produção no ambiente, `pnpm templates:backfill` uma vez e redirecionamento 301 do domínio antigo. Conferir que o `x-forwarded-for` vem do proxy confiável (limites por IP; pendência 4 da Fatia 3). Hoje o Compose só publica o app em `127.0.0.1`. | Fase ou fatia de infraestrutura, depois das fatias de produto | D2 |
| 2 | **Provedor real de e-mail.** Confirmar o Resend (premissa de decisoes.md), testar o `ResendEmailProvider` contra a API real com chave de teste e configurar SPF/DKIM/DMARC no subdomínio de `EMAIL_FROM_DOMAIN`. Decidir `Reply-To` (hoje `nao-responda@…`). | Antes de ligar o e-mail em produção | premissa; fase8.md 1, 4 |
| 3 | **Exclusão/anonimização de dados do cliente (LGPD).** `outbound_messages` fica sem prazo de retenção, como `messages` e `contacts`; não há rota nem tela para apagar ou anonimizar um contato a pedido dele. Junta-se às pendências da Fatia 2 (1) e da Fatia 3 (2). | Fatia própria ou junto da exclusão de conta | impacto (LGPD) |
| 4 | **LGPD, finalidade do e-mail.** O e-mail do contato passou a ser canal de reserva; falta citar isso no texto de consentimento do agendamento público. | Ajuste de texto na tela da Fatia 2 | fase8.md 3 |
| 5 | **Nada chama `enqueueMessage` para a confirmação de agendamento.** O agendamento público e o manual ainda não enfileiram `appointment_confirmation` (chave sugerida `appointment_confirmation:<appointmentId>`). Só a confirmação de opt-out é enfileirada hoje. | Fatia 5 (lembretes) ou fase própria | fase6.md 1 |
| 6 | **Plano e cobrança ativos na regra (b):** ligar `hasActivePlan` e `hasActiveCharge` quando as tabelas existirem; ao ampliar os tipos de mensagem, trocar os dois CHECKs (`outbound_messages_message_type_check`, `message_templates_message_type_check`) na mesma migração. | Fatias 6 e 7 | fase2.md 3; fase3.md 1 |
| 7 | **`AkgProvider` real** (herdada da Fatia 3, pendência 1): o envio de produção depende do Swagger do AKG. | Quando houver o Swagger | Fatia 3 |
| 8 | **Resposta manual pela tela de conversas.** | Fatia 8 | D6 |

## Decisões a pedir ao usuário (mudariam D4, D11, D15 ou o escopo)
| # | Pendência | Origem |
|---|-----------|--------|
| 9 | Pontuação no opt-out: `Sair.`, `STOP!` não descadastram pela D4 literal; perder um opt-out é o risco maior. | fase7.md 1 |
| 10 | Confirmação de opt-out fora das 8h às 20h espera as 8h (D11 só isenta a confirmação de agendamento). | fase4.md 1; fase7.md 3 |
| 11 | Segundo opt-out depois de `VOLTAR` não recebe nova confirmação (D15: nunca repetir). | fase7.md 2 |
| 12 | Curva da D3 chega a 200 no dia 11, mas o aquecimento é "de 14 dias"; confirmar se a curva vai até o dia 14. | fase4.md 2 |
| 13 | Ligar/desligar template (`active`): não exposto na API nem na tela; desligar `optout_confirmation` contraria a D15. Decidir se o dono pode desligar `appointment_confirmation`. | fase9.md 3; fase11.md 2 |
| 14 | Reativação do opt-out pelo dono (D4 prevê; a tela não existe). | plano, Fase 7 "Fora" |
| 15 | Agendamento `confirmed` no passado e nunca concluído mantém o contato elegível pela regra (b) para sempre. | fase3.md 2 |
| 16 | Regra (c) aceita qualquer `consent_at`; o dono ainda não registra consentimento no painel (pendência 4 da Fatia 2). | fase3.md 3 |

## Técnicas (achadas nas fases, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 17 | Envio feito e não gravado: se o processo cair entre `sendText` e `markSent`, a linha fica `queued` e um job reprocessado pode reenviar. Avaliar um estado `sending` (muda o CHECK de status). | fase6.md 3 |
| 18 | Trava do tenant com prazo de 60 s: envio mais banco acima disso deixa outro job do mesmo número entrar. Avaliar renovar a trava. | fase6.md 4 |
| 19 | Linhas `queued` sem job (perda do Redis, falha ao enfileirar a confirmação de opt-out depois do commit): só voltam se o evento for enfileirado de novo. Varredura periódica de reenfileiramento. | fase6.md 5; fase7.md 4 |
| 20 | `duplicate_request` (409 do Resend) vira `failed` mesmo que o e-mail possa ter saído (só se o conteúdo mudar entre tentativas). | fase8.md 2 |
| 21 | A varredura `tests/outbound-send-boundary.test.ts` cobre `sendText`; o envio de e-mail (`EmailProvider.send`) também só é chamado pelo worker hoje (conferido por busca na Fase 12), mas não há teste de varredura para ele. | Fase 12 |
| 22 | Branch test do Neon (0,25 CU) instável: `P1001`/`P1017` e timeouts intermitentes; a suíte completa às vezes cai sem relação com o código. Avaliar timeouts no `pg` dos testes ou Postgres local. | fase3.md 5 e seguintes |
| 22b | Testes de concorrência da agenda (`agenda-api`, `public-api`) seguem intermitentes (pendência 8 da Fatia 3): falharam numa das rodadas da Fase 12 e passaram nas seguintes. | Fase 12 |
| 23 | `pg` avisa `client.query()` concorrente (será removido no pg 9) nos testes e no servidor do E2E; Vite avisa `vitest.config.ts` em ESM carregado como CommonJS. | Fase 12 (saída da suíte) |
| 24 | A suíte E2E inteira passa de 10 min (QR com 60 s reais do Fake, 52 webhooks da paginação); na Fase 12 rodou em 4 grupos. | Fase 12; Fatia 3, pendência 11 |

## Produto e telas (melhorias, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 25 | Bloco de uso em `/painel/whatsapp` não faz polling; o uso do dia só atualiza ao recarregar. | fase10.md 3 |
| 26 | No celular, o separador "·" pode ficar no fim da linha quando o telefone quebra (cosmético). | fase10.md 4 |
| 27 | Tela de templates: trocar de linha ou cancelar descarta alterações sem perguntar; restaurar padrão não pede confirmação (só "Desfazer" no toast); a prévia usa dados fixos ("Estúdio Aurora"), não o nome do negócio. | fase11.md 3, 4, 5 |
