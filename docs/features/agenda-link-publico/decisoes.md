# Decisões: Agenda e link público

| # | Decisão | Origem | Data |
|---|---------|--------|------|
| 1 | Rota pública em `/{slug}`, com lista de slugs reservados (login, cadastro, painel, api e outros) | padrão sugerido, aceito | 2026-10-10 |
| 2 | Site público com várias páginas e menu: Início, Serviços, Equipe, Agendar; Tenant ganha descrição, endereço e telefone | usuário | 2026-10-10 |
| 3 | Parâmetros da agenda configuráveis por tenant em `/painel/configuracoes`: passo da grade, buffer, antecedência mínima, janela máxima, prazo de cancelamento. Padrões: 15 min, 0, 2 h, 60 dias, 2 h | usuário (configurável); lista e padrões sugeridos | 2026-10-10 |
| 4 | Status `confirmed`, `canceled`, `completed`; só `confirmed` ocupa horário; dono marca `completed` manualmente | padrão sugerido, aceito | 2026-10-10 |
| 5 | Customer por tenant; nome e telefone obrigatórios, e-mail opcional; telefone normalizado (dígitos, DDI 55); consentimento LGPD; sem login do cliente | padrão sugerido, aceito | 2026-10-10 |
| 6 | Link de gestão `/{slug}/agendamento/{token}` (hash SHA-256 no banco), exibido na tela; cancelar e remarcar até o prazo configurável (padrão 2 h) | padrão sugerido, aceito | 2026-10-10 |
| 7 | Sem e-mail nesta fatia. WhatsApp só na Fatia 3, implementação real (adapter WA-AKG, QR code) | usuário | 2026-10-10 |
| 8 | Limite de requisições por IP na rota pública (tabela de tentativas da Fatia 1); sobreposição barrada por exclusion constraint `btree_gist` (por profissional, só `confirmed`); violação vira 409 e a tela recarrega os horários | padrão sugerido, aceito | 2026-10-10 |
| 9 | Painel `/painel/agenda`: dia e semana (lista no celular); agendamento manual, cancelar, remarcar, concluir; bloqueios avulsos sem recorrência | padrão sugerido, aceito | 2026-10-10 |
| 10 | Agendamento `confirmed` conta como "agendamento ativo" para elegibilidade de contato (implementação na Fatia 4) | padrão sugerido, aceito | 2026-10-10 |
| 11 | Fuso do tenant via biblioteca de fuso, sem somar horas fixas, para cobrir horário de verão em teste | padrão sugerido, aceito | 2026-10-10 |

## Premissas assumidas
- Os cinco parâmetros configuráveis e seus padrões (decisão 3) foram sugeridos por mim; o usuário confirmou "configurável pela empresa", não a lista.
- O mini-site (decisão 2) usa só texto: descrição, endereço, telefone, serviços e equipe já cadastrados; sem fotos nem personalização visual.
- Como o cliente não recebe o link por nenhum canal, quem perder o link só cancela ou remarca falando com o negócio (o dono cancela e remarca no painel).
