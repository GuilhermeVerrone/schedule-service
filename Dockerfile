# Imagem única do Slotz (D2): o serviço "app" roda o Next e o "worker" roda src/worker/main.ts.
# Nenhum segredo entra na imagem: tudo vem do ambiente na hora de rodar (docker-compose.yml).

FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/corepack
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
WORKDIR /app

# Dependências (o postinstall gera o client do Prisma a partir do schema).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# src/lib/db.ts exige DATABASE_URL ao ser importado, e o build importa as rotas para coletar a
# configuração. Endereço fictício e inalcançável, só nesta etapa: não é segredo e nenhuma consulta
# roda no build. A URL real vem do ambiente na hora de rodar.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
