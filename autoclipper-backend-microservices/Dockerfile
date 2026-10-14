FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
RUN npm install --global npm@11.12.1
COPY . .
RUN npm ci && npm run build && npm run openapi:export && npm prune --omit=dev

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
WORKDIR /app
RUN printf '%s\n' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261013T000000Z bookworm main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261013T000000Z bookworm-security main' \
      > /etc/apt/sources.list \
    && rm /etc/apt/sources.list.d/debian.sources \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install --yes --no-install-recommends ffmpeg=7:5.1.9-0+deb12u1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps ./apps
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json
ENV NODE_ENV=production HOST=0.0.0.0 NODE_OPTIONS=--max-old-space-size=256
USER node
CMD ["node", "apps/autoclipper-api-gateway/dist/main.js"]

FROM runtime AS verification
COPY --from=build --chown=node:node /app/tests ./tests
CMD ["node", "--test", "--test-concurrency=1", "tests/integration/*.test.mjs"]
