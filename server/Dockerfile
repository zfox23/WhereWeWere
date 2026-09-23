# Build context: repo root (see docker-compose.yml) so the shared/ plugin
# contract package is available to the server build.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared ./shared
COPY plugins ./plugins
COPY server ./server
RUN npm install
RUN npm run build --workspace=shared
RUN npm run build --workspace=server

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/server/package.json ./
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/src/db/migrations ./dist/server/src/db/migrations
EXPOSE 3001
CMD ["node", "dist/server/src/index.js"]
