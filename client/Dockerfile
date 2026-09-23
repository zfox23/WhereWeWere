# Build context: repo root (see docker-compose.yml) so the shared/ plugin
# contract package is available to the client build.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared ./shared
COPY plugins ./plugins
COPY client ./client
RUN npm install
ARG VITE_API_ACCESS_TOKEN=
ENV VITE_API_ACCESS_TOKEN=$VITE_API_ACCESS_TOKEN
RUN npm run build --workspace=client

FROM nginx:alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
