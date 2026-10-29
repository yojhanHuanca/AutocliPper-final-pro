FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
RUN npm install --global npm@11.12.1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4200 STATIC_ROOT=/app/browser PUBLIC_API_BASE_URL=http://localhost:3005/v1
COPY --from=build --chown=node:node /app/dist/autoclipper/browser ./browser
COPY --chown=node:node docker/serve.mjs ./serve.mjs
USER node
EXPOSE 4200
CMD ["node", "serve.mjs"]
