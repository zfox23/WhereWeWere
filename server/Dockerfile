FROM node:20-alpine AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY server/src/db/migrations ./dist/db/migrations
RUN mkdir -p /data/photos
EXPOSE 3001
CMD ["node", "dist/index.js"]
