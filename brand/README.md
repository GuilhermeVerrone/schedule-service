# Identidade visual do Slotz

Versão 1.2, proposta de 2026-10-15 ("z." em peso leve; símbolo quadrado, rente nas laterais). O Slotz é um produto da Algoritmi e herda o sistema visual dela. Este pacote acrescenta o que é só do Slotz: logo, símbolo, ícones, estados de agenda e voz do produto.

Regra de partida: **o que a Algoritmi já definiu não muda.** Paleta, Poppins + Manrope, raios, sombras em grafite e a regra de "problema antes da tecnologia" valem aqui. O Slotz só ganha uma assinatura própria.

## Conceito

Slotz vem de *slot*, o horário que o cliente reserva. O símbolo é uma pequena agenda desenhada como três blocos de horário em degraus leves, numa grade quadrada, sem margem sobrando nas laterais. O último bloco encurta e dá lugar a um ponto: o **ponto final** do nome, o mesmo traço da logo "algoritmi.", agora como horário preenchido.

Os blocos escalonados também lembram linhas de conversa. Agenda e atendimento no mesmo desenho.

## Logo

| Versão | Arquivo | Quando |
|---|---|---|
| Completa (símbolo + nome) | `logos/slotz-logo*.svg` | Padrão: cabeçalho, capa, e-mail, apresentações |
| Só nome | `logos/slotz-wordmark*.svg` | Quando o símbolo já aparece ao lado ou é redundante |
| Só símbolo | `logos/slotz-simbolo*.svg` | Espaço quadrado ou estreito, a partir de 20 px de lado |
| Ícone do app | `icones/` | Favicon, app instalado (PWA), foto de perfil do WhatsApp |

Os arquivos sem sufixo usam `currentColor` (herdam a cor do texto). Os sufixos `-grafite` e `-branco` trazem a cor fixa para uso em `<img>`, PDF e redes sociais.

- O nome está em curvas: "slot" em Poppins 700 e "z." em Poppins 400, o peso mais leve fechando a palavra, como o "ritmi." da Algoritmi. **Não recriar com texto.** O arquivo é a marca.
- **Cor:** uma só por aplicação, sólida. Grafite `#262223` sobre claro; branco suave `#F2F2F2` sobre grafite profundo `#211D1E` ou sobre violeta `#492DEB`. Nunca violeta sobre fundo claro.
- **Área de proteção:** meia altura da logo (½H) livre em todos os lados.
- **Tamanho mínimo:** completa 20 px de altura (6 mm em impressão); só símbolo 20 px de lado. Abaixo disso, usar o ícone do app, que tem blocos mais grossos para ler em 16 px.
- **Usos incorretos:** distorcer ou girar; recolorir fora da tabela; aplicar sombra, contorno ou gradiente; separar o ponto do nome; trocar a ordem dos blocos; pôr sobre imagem sem contraste; combinar com a logo da Algoritmi sem separação clara.
- **Nome em texto corrido:** "Slotz", com S maiúsculo. A grafia minúscula "slotz." existe só na logo.

### Relação com a Algoritmi

- Assinatura de endosso: "Slotz, um produto Algoritmi." Em Manrope 400, cor secundária do texto, no rodapé e em páginas institucionais.
- Não repetir a assinatura da Algoritmi junto da logo do Slotz no cabeçalho. Uma marca por vez.
- O Slotz não ganha cor própria. O violeta é o mesmo da Algoritmi.

## Cor

Herdada da Algoritmi, já em `src/app/globals.css`.

| Papel | Token | Hex |
|---|---|---|
| Fundo | `paper` | `#F2F2F2` |
| Superfície | `surface` | `#FFFFFF` |
| Texto e logo sobre claro | `ink` | `#262223` |
| Áreas escuras | `night` | `#211D1E` |
| Ação principal e destaque | `violet` | `#492DEB` |
| Link e apoio | `violet-deep` | `#44349E` |

Violeta vivo não é cor de texto corrido. Link e apoio usam o violeta fechado.

### Acréscimos do Slotz (`tokens/slotz-tokens.css`)

Estados financeiros, só para cobrança: **pago** `#1B6E45`, **a vencer** `#80530A`, **atrasado** `#B3261E` (já existia como `danger`). Cada um com fundo a 8–12% de opacidade. Texto sobre o próprio fundo passa de 5,3:1.

Estados do horário, derivados da marca e sem cor nova:

| Estado | Aparência |
|---|---|
| Livre | Fundo branco, borda cinza-grafite |
| Aguardando confirmação | Fundo violeta a 7%, borda violeta a 28%, texto violeta fechado |
| Confirmado | Violeta sólido, texto branco suave |
| Bloqueado | Fundo cinza claro com hachura fina em grafite |

Estado nunca depende só da cor: sempre rótulo ou ícone junto.

## Tipografia

Igual à Algoritmi. Poppins 600 só em títulos; Manrope 400/500/600 no resto. Uma terceira família nunca entra. Números de agenda (horários, valores) usam `tabular-nums`.

## Forma, ícones e movimento

- Raios: 6 (folha), 10 (controle), 16 (quadro), 24 (painel). A logo usa pontas totalmente arredondadas, então o desenho do símbolo conversa com botões e chips do app.
- Ícones: Lucide, que já está no projeto, traço arredondado e um peso só por tela.
- Sombras em grafite com baixa opacidade. Movimento curto, respeitando `prefers-reduced-motion`.

## Voz

Herda a voz da Algoritmi (competente, objetiva, próxima) e fala com o dono do negócio por "você".

| Evitar | Preferir |
|---|---|
| Otimize sua jornada de atendimento omnichannel | Seu cliente marca o horário sozinho, mesmo quando você está atendendo |
| Gestão inteligente de recebíveis | Cobrança por Pix, cartão ou boleto, com lembretes na medida certa |
| Clique aqui para saber mais | Criar minha conta |

- Frase curta, verbo no começo, benefício na rotina de quem atende.
- Sem número, resultado ou cliente que não seja real.
- Mensagens ao cliente final são avisos do sistema (lembrete, confirmação, cobrança), nunca campanha.

**Assinatura sugerida:** *Atenda, agende e cobre pelo WhatsApp.* Alternativas: *Seu horário, seu cliente, seu dinheiro no lugar.* e *Agenda e atendimento que não param quando você está atendendo.*

## Aplicações incluídas

- `social/slotz-og.png`: imagem de compartilhamento 1200×630, capa em grafite profundo com filete violeta, como as capas da Algoritmi.
- `icones/`: favicon SVG e PNG (32, 48), ícone de 192 e 512, versão maskable e apple-touch.

## Para aplicar no app

1. Copiar `icones/slotz-favicon.svg` para `src/app/icon.svg` e `icones/apple-touch-icon.png` para `src/app/apple-icon.png`.
2. Copiar `social/slotz-og.png` para `src/app/opengraph-image.png`.
3. Trocar o título "Slotz" de `src/components/brand/wordmark.tsx` pelo SVG `logos/slotz-logo.svg` (herda `currentColor`).
4. Colar `tokens/slotz-tokens.css` no `globals.css`.

## Pendências

| Pendência | Quem decide |
|---|---|
| Aprovar o símbolo e o lockup (proposta v1) | Usuário, com o designer da Algoritmi |
| Escolher a assinatura de marca entre as três sugeridas | Usuário |
| Revisar o endosso "um produto Algoritmi" quando o domínio migrar | Usuário |
