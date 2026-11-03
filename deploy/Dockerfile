# Services only: the relayer, agent and demo API. The web app is hosted separately.
FROM node:24-slim
RUN npm install -g pnpm@10.34.6
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod \
  --filter "@talaria-pay/relayer..." --filter "@talaria-pay/agent..." --filter "@talaria-pay/demo-api..."
RUN mkdir -p services/relayer/data && chown -R node:node services/relayer/data
USER node
