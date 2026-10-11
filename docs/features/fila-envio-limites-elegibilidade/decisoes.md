# Decisões: Fila de envio, limites e elegibilidade

| # | Decisão | Origem | Data |
|---|---------|--------|------|
| 1 | Fila com BullMQ e Redis em contêiner Docker (Compose), sem porta pública, AOF ligado e `noeviction`; Postgres continua no Neon. `REDIS_URL` em env | resposta do usuário (VPS + Docker) | 2026-10-11 |
| 2 | Fatia 4 entrega o `worker` (processo separado, mesma imagem do app) e o `redis` rodando em Compose, mais rota de saúde. Deploy completo na VPS (proxy, HTTPS, domínio, backup) fica como fase/fatia própria de infraestrutura depois das fatias de produto | padrão sugerido, aceito | 2026-10-11 |
| 3 | Fila e limites por número (tenant): intervalo aleatório de 8 a 25 s entre mensagens; teto diário de 200 para conexão madura; aquecimento de 14 dias (dias 1-2: 20, 3-4: 40, 5-6: 80, 7-8: 120, 9-10: 160, 11+: 200); contado desde a primeira conexão `connected`, reconexão não zera; valores em constantes de configuração | padrão sugerido, aceito | 2026-10-11 |
| 4 | Opt-out: a mensagem inteira (sem diferenciar maiúscula, acento ou espaço) é `SAIR`, `PARAR`, `CANCELAR` ou `STOP`; frase com a palavra no meio não conta. Efeito imediato, uma única confirmação registrada. Reativação: contato escreve `VOLTAR` ou o dono reativa | padrão sugerido, aceito | 2026-10-11 |
| 5 | Templates no banco, editáveis pelo dono, com 3 ou mais variações por tipo de mensagem e variáveis tipadas; textos padrão no código criam os templates de cada tenant novo; variação escolhida ao acaso sem repetir a última usada para o mesmo contato. Entra tela de edição de templates | resposta do usuário (mudou o padrão) | 2026-10-11 |
| 6 | Painel (`/painel/whatsapp`), somente leitura: uso de hoje ("42 de 200"), fase do aquecimento e lista de envios bloqueados com o motivo. Resposta manual pela tela de conversas fica fora (Fatia 8) | padrão sugerido, aceito | 2026-10-11 |
| 7 | Teto diário atingido: mensagem fica adiada e sai no dia seguinte, em ordem; lembrete e cobrança com mais de 24 h de atraso viram `expired` e são registrados; confirmação de agendamento tem prioridade | padrão sugerido, aceito | 2026-10-11 |
| 8 | Sem canal (WhatsApp caído e contato sem e-mail): registrar `blocked` com motivo `no_channel`, exibir no painel, sem nova tentativa por outro caminho | padrão sugerido, aceito | 2026-10-11 |
| 9 | O "dia" do teto vira à meia-noite do fuso do tenant, não em UTC | padrão sugerido, aceito | 2026-10-11 |
| 10 | Retentativa: 3 tentativas com espera crescente (1, 5 e 15 min); falha final fica `failed` e não gasta o teto | padrão sugerido, aceito | 2026-10-11 |
| 11 | Mensagens proativas só entre 8h e 20h do fuso do tenant; fora disso esperam. Exceção: confirmação de agendamento recém-criado | padrão sugerido, aceito | 2026-10-11 |
| 12 | Redis fora do ar: o envio falha de forma visível (registro `failed`), nunca silenciosa; o agendamento em si não é afetado | padrão sugerido, aceito | 2026-10-11 |
| 13 | Agendamento `confirmed` conta como "agendamento ativo" na regra (b) de elegibilidade (pendência 3 da Fatia 2) | pendências da Fatia 2 | 2026-10-11 |
| 14 | O limite diário efetivo vem da política (aquecimento até 200); `daily_send_limit` vira teto manual opcional do dono, com padrão nulo | resposta do usuário (impacto 1) | 2026-10-11 |
| 15 | A confirmação de opt-out sai pela mesma fila, conta no teto, é tratada como resposta a mensagem recém-recebida (regra a) e é marcada para nunca repetir | resposta do usuário (impacto 2) | 2026-10-11 |
| 16 | Tipos de mensagem iniciais dos templates: `appointment_confirmation` e `optout_confirmation`; os demais entram nas Fatias 5 a 7. O tipo vem de lista fechada, sem tipo livre | resposta do usuário (impacto 3) | 2026-10-11 |

## Premissas assumidas
- Provedor de e-mail do fallback: não definido. Premissa: interface `EmailProvider` com `FakeEmailProvider` nos testes e provedor real (sugestão: Resend) configurado por env, a confirmar antes da fase de e-mail.
- Os valores da decisão 3 são uma sugestão conservadora, sem garantia contra banimento.
- A Fatia 4 só começa depois da Fatia 3 concluída e commitada (contrato do `sendText`, `Contact` e `WhatsAppConnection`).
