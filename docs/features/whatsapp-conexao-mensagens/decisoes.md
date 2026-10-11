# Decisões: WhatsApp (adapter, conexão, mensagens)

| # | Decisão | Origem | Data |
|---|---------|--------|------|
| 1 | Unificar Contact e Customer: Customer da Fatia 2 vira Contact e ganha origem e data do consentimento, opt_out e last_inbound_at (migração e renomeação) | padrão sugerido, aceito | 2026-10-10 |
| 2 | Telefone sempre em E.164 com "+" e DDI (ex.: +5511999998888); uma função única de normalização para as Fatias 2 e 3; sem DDI recebe 55; nono dígito do BR coberto por teste | padrão sugerido, aceito | 2026-10-10 |
| 3 | Sem Redis/BullMQ nesta fatia: webhook valida token, grava WebhookEvent (unicidade garante idempotência) e processa no mesmo request. Fila entra na Fatia 4 | padrão sugerido, aceito | 2026-10-10 |
| 4 | Botões e lista fora desta fatia (Fatia 8); contrato do adapter só com sendText | padrão sugerido, aceito | 2026-10-10 |
| 5 | Interface e AkgProvider têm sendText; FakeProvider registra envios nos testes; nenhuma tela ou fluxo chama sendText nesta fatia | padrão sugerido, aceito | 2026-10-10 |
| 6 | Conversas somente leitura; resposta manual pelo painel entra na Fatia 4 (limites e elegibilidade) | padrão sugerido, aceito | 2026-10-10 |
| 7 | Tela `/painel/conversas`: lista (contato, última mensagem, horário) e página por conversa, 50 mensagens por página; mídia guarda só o tipo e mostra "[imagem]"/"[áudio]", sem baixar arquivo | padrão sugerido, aceito | 2026-10-10 |
| 8 | Webhook: segredo `WHATSAPP_WEBHOOK_SECRET` comparado em tempo constante; tenant resolvido por `WhatsAppConnection.sessionId`, nunca pelo corpo; rota pública no proxy com limite por IP; corpo inválido responde 200 vazio e é logado sem o conteúdo | padrão sugerido, aceito | 2026-10-10 |
| 9 | Sem exclusão automática de mensagens nesta fatia; exclusão/anonimização de dados do cliente fica como pendência junto com a da Fatia 2 | padrão sugerido, aceito | 2026-10-10 |
| 10 | Link público segue `/{slug}` (decisão 1 da Fatia 2), divergindo do `/b/{slug}` do prompt-guide; migração futura via redirecionamento | padrão sugerido, aceito | 2026-10-10 |
| 11 | Telefone aceita qualquer número E.164 válido ("+" e 10 a 15 dígitos); sem DDI, assume 55 (padrão Brasil) | resposta do usuário | 2026-10-10 |
| 12 | Contato criado por mensagem recebida usa o nome do perfil do WhatsApp (se o AKG enviar), com o telefone como alternativa; `consent_at` nulo e origem `whatsapp_inbound` | resposta do usuário | 2026-10-10 |

## Premissas assumidas
- A pergunta sobre o Swagger/instância do AKG não teve resposta explícita. Premissa: o `AkgProvider` é implementado com endpoints marcados como TODO (criar sessão, obter QR, formato do webhook, envio), isolados no adapter, com a lista do que confirmar; env vars `AKG_BASE_URL` e `AKG_API_KEY` entram no `.env.example`. A parte real contra o AKG fica pendente até o usuário fornecer o Swagger ou uma instância. Isso reduz o critério "implementar de verdade" do guia: o fluxo completo é provado com o FakeProvider.
- A decisão 1 altera tabela e código da Fatia 2; a Fatia 3 só começa a executar depois que a Fatia 2 estiver concluída.
