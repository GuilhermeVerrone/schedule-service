# Guia: WhatsApp (adapter, conexão, mensagens)

Slug: `whatsapp-conexao-mensagens` (Fatia 3 do prompt-guide.md na raiz). Status: aprovado em 2026-10-10.

1. **feature:** Integração com WhatsApp não oficial (WA-AKG) atrás de um adapter: conexão por QR code, saúde da conexão e recebimento de mensagens.
2. **resumo:** O dono conecta o WhatsApp do negócio lendo um QR code, acompanha o estado da conexão e vê as conversas dos clientes que chegam, tudo isolado por tenant.
3. **interface:** Painel: `/painel/whatsapp` (conexão, QR code, status, alerta de queda, botão reconectar e aviso de risco de banimento) e uma tela de conversas (?: rota e se permite responder; ver fora). Webhook fixo `/api/webhooks/whatsapp` (URL base vem de `APP_BASE_URL`). Interface `WhatsAppProvider` em `src/server`, com `AkgProvider` e `FakeProvider`. Visual no padrão da Algoritmi.
4. **perfis:** Dono (`owner`): conecta, desconecta e lê as conversas do próprio tenant. Provedor AKG: chama o webhook (autenticado por segredo). Cliente final: escreve pelo WhatsApp; não acessa o Slotz. Isolamento por tenant continua valendo.
5. **dados:**
   - WhatsAppConnection: uma por tenant; status `connected | disconnected | qr_pending | banned_suspected`; id da sessão no AKG (?); última checagem; contadores e limites diários (campos criados agora, uso na Fatia 4).
   - Contact (?: criar novo conforme prompt-guide ou reaproveitar Customer da Fatia 2; telefone E.164, origem e data do consentimento, opt_out, last_inbound_at).
   - Conversation (tenant, contato, última mensagem) e Message (direção, texto, status de entrega, id externo, idempotência).
   - WebhookEvent: origem, id do evento, processado_em (idempotência).
6. **regras:**
   - O produto só chama o adapter, nunca o AKG direto; trocar por Meta Cloud API exige só um novo provider.
   - Eventos do AKG são normalizados para `InboundMessage`, `DeliveryStatus` e `ConnectionStatus`.
   - Contrato do adapter: `connect`, `getStatus`, `sendText`, `disconnect`, `onInboundMessage`, `onStatusUpdate` (botões/lista opcionais com fallback para texto numerado: ?).
   - Webhook: validar token/assinatura, ser idempotente (WebhookEvent), responder 200 rápido e processar em fila (?: fila BullMQ/Redis já nesta fatia ou processamento direto até a Fatia 4).
   - Mensagem recebida cria/atualiza Contact, Conversation e Message e atualiza `contact.last_inbound_at`.
   - Não inventar endpoints do AKG: confirmar no Swagger de uma instância (criar sessão, obter QR, formato do webhook); o que faltar fica como TODO isolado no adapter. Não usar `broadcast`.
   - Uma sessão AKG por tenant; o tenant do webhook é resolvido pela sessão, nunca por dado enviado pelo cliente.
   - Segredos (chave do AKG, token do webhook) só em variáveis de ambiente, nunca logados.
   - Telefones normalizados para E.164; dado pessoal do contato mínimo necessário (LGPD).
7. **jornadas:**
   - (a) Dono abre `/painel/whatsapp`, vê o aviso de risco, gera o QR code, lê com o celular e a conexão fica `connected`.
   - (b) A conexão cai: o painel mostra o alerta e o dono clica em reconectar.
   - (c) Cliente escreve no WhatsApp do negócio: webhook entra, mensagem é salva uma única vez (mesmo se o AKG reenviar), contato e conversa são criados ou atualizados.
   - (d) Dono vê a lista de conversas e as mensagens de cada uma (?: somente leitura nesta fatia).
   - (e) Dono desconecta o WhatsApp.
   - (f) Webhook sem token válido, de sessão desconhecida ou duplicado não altera dados de nenhum tenant.
8. **fora:** Envio proativo, fila de envio, rate limit por número, aquecimento, teto diário e variação de texto (Fatia 4); elegibilidade, opt-out e fallback por e-mail (Fatia 4); lembretes (Fatia 5); chatbot e respostas automáticas (Fatia 8); API oficial da Meta; campanhas e disparos em massa (não existem no produto). Responder mensagens manualmente pela tela: ?.
9. **pronto:**
   - Adapter com contrato testado e `FakeProvider` cobrindo todos os eventos nos testes; nenhum código fora do adapter chama o AKG.
   - Conexão por QR code funciona de ponta a ponta com `FakeProvider` (Playwright, mobile e desktop) e o `AkgProvider` está implementado contra o Swagger real ou com TODOs listados.
   - Painel de saúde mostra status, alerta de queda e botão reconectar.
   - Webhook recusa token inválido, é idempotente e atualiza `last_inbound_at`.
   - Conversas e mensagens isoladas por tenant (testes de repositório e API).
   - Sem segredo no repositório; `.env.example` com os nomes novos.
