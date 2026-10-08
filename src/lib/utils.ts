import { createCn } from "cn/config"

// Merge de classes Tailwind ciente da escala de texto da Algoritmi (globals.css). Sem isto, o
// merge lê `text-label` como cor e o descarta ao lado de `text-on-dark` (o botão perdia o peso
// 600 e o tamanho quando recebia className).
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "headline", "title", "lead", "body", "small", "label", "micro"] }],
    },
  },
})
