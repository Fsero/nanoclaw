FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build


FROM node:22-slim

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/dist ./dist
COPY container/ ./container/
COPY setup/ ./setup/
COPY groups/ ./groups/

RUN mkdir -p store data logs \
    && chown -R node:node /app

USER node

ENV NODE_ENV=production

VOLUME ["/app/store", "/app/data", "/app/groups", "/app/logs"]

CMD ["node", "dist/index.js"]
