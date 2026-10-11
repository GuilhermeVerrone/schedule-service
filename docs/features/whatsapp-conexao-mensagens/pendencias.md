# Pendências: WhatsApp (adapter, conexão, mensagens)

Registradas no fechamento (Fase 8, 2026-10-11), a partir das evidências das Fases 1 a 7. Nada aqui foi implementado nesta fatia.

## Fora da fatia por decisão ou premissa
| # | Pendência | Para onde vai | Ref |
|---|-----------|---------------|-----|
| 1 | **Swagger do AKG / parte real do `AkgProvider`.** Todos os endpoints estão `null` e cada operação responde `not_implemented`. Confirmar numa instância: (1) autenticação da `AKG_API_KEY`; (2) criar sessão e se aceita id nosso; (3) QR: formato, validade, renovação; (4) status e mapeamento para os 4 estados (existe sinal de banimento?); (5) envio de texto: formato do destinatário e id devolvido, sem broadcast; (6) desconectar: logout x apagar sessão; (7) webhook: cadastro da URL, como vem o segredo (header, query ou HMAC; hoje aceitamos `x-webhook-secret` ou `Bearer`), nomes dos eventos, id da sessão, id do evento (precisa ser único globalmente, porque `webhook_events` é único por `source + event_id`), telefone, nome do perfil, tipo de mídia, reenvio e timeout; (8) limites e erros. Enquanto isso, com `WHATSAPP_PROVIDER=akg` o webhook responde 500 a todo evento. | Quando o usuário fornecer o Swagger ou uma instância | premissa de decisoes.md; `src/server/whatsapp/akg-provider.ts` (`TODO(AKG)`) |
| 2 | **Exclusão/anonimização de dados (LGPD).** Mensagens e contatos ficam sem prazo de retenção; não há rota nem tela para apagar ou anonimizar um contato e suas conversas a pedido dele. Junta-se à pendência 1 da Fatia 2 (exclusão do cliente final). | Fatia própria ou junto da exclusão de conta | D9; impacto (LGPD) |
| 3 | **Fila (Redis/BullMQ).** O webhook processa no mesmo request (D3); rajadas serializam e um provedor com timeout curto reenviaria (a idempotência cobre). Mover o processamento para fila, com retry. | Fatia 4 | D3 |
| 4 | **`x-forwarded-for`.** O limite por IP do webhook (e da API pública) confia no primeiro `x-forwarded-for`. Na hospedagem final, confirmar que o valor vem do proxy confiável; o teto de 600/min por IP é palpite até conhecer volume e IPs do provedor. | Hospedagem / Fatia 4 | D8; pendência 9 da Fatia 2 |
| 5 | **Envio e resposta manual**: rate limit por número, intervalo aleatório, teto diário (campos já criados, teto provisório 100), aquecimento, variação de texto, elegibilidade, opt-out e e-mail de reserva. Elegibilidade deve olhar `consent_at`, não `consent_source` (o inbound grava `whatsapp_inbound` com `consent_at` nulo). | Fatia 4 | D5, D6, D12 |
| 6 | Botões e listas no adapter (com fallback para texto numerado) e chatbot. | Fatia 8 | D4 |

## Técnicas (achadas nas fases, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 7 | Desconectar pelo dono e queda são o mesmo estado (`disconnected`): ao reabrir a tela depois de desconectar, aparece o alerta de queda. Guardar o motivo (`reason`) na conexão resolveria (schema/API). | Fase 6 |
| 8 | Teste de concorrência da agenda (Fatia 2) é intermitente: P2034 (deadlock) no `appointment.create` sai como 500 em vez de 409. Não falhou nas rodadas da Fase 8. | Fases 2, 3 |
| 9 | Tenant de teste órfão `teste-ag-a-*` na branch test (sobra de execução antiga da suíte da agenda). | Fase 4 |
| 10 | O QR do `FakeProvider` leva o id da sessão no conteúdo (só no Fake; não afeta produção). | Fase 5 |
| 11 | O E2E de expiração do QR espera os 60 s reais do Fake; um TTL configurável encurtaria o teste. O E2E da paginação manda 52 webhooks em sequência. A suíte E2E inteira leva cerca de 12 min. | Fases 6, 7 |
| 12 | `.vitest/json/output.json` versionado e reescrito pelo hook do RTK; avaliar tirar do Git. | Fase 3 (já na Fatia 2, pendência 13) |
| 13 | Aviso do Vite: `vitest.config.ts` em ESM carregado como CommonJS (`configLoader: 'native'` vai virar padrão). | Fase 8 |

## Produto e telas (melhorias, não feitas)
| # | Pendência | Origem |
|---|-----------|--------|
| 14 | "Última verificação" da tela do WhatsApp usa o fuso do navegador; as conversas já usam o do negócio. | Fases 6, 7 |
| 15 | Sem indicação de "não lida" nem contador de novas no menu (precisa de `read_at`/último visto). | Fase 7 |
| 16 | Lista de conversas sem busca por nome ou telefone. | Fase 7 |
| 17 | Menu em linha única só a partir de 1100px; com mais itens (Fatias 4+), agrupar ou usar menu compacto. | Fase 7 |
| 18 | Passos para ler o QR no celular seguem o WhatsApp atual; conferir quando o provedor real for ligado. | Fase 6 |
