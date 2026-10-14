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
RUN apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install --yes --no-install-recommends fonts-dejavu-core=2.37-6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps ./apps
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json
ENV NODE_ENV=production HOST=0.0.0.0 NODE_OPTIONS=--max-old-space-size=256
USER node
CMD ["node", "apps/autoclipper-api-gateway/dist/main.js"]

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS whisper-build
RUN printf '%s\n' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261013T000000Z bookworm main' \
      'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261013T000000Z bookworm-security main' \
      > /etc/apt/sources.list \
    && rm /etc/apt/sources.list.d/debian.sources \
    && apt-get update -o APT::Update::Error-Mode=any \
    && apt-get install --yes --no-install-recommends cmake=3.25.1-1 g++=4:12.2.0-3 make=4.3-4.1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:645445da884df6dbd52b30f82d7be7c01d1767c938714e477e786b88d529e9f4 https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/d1be6fde11ac6e0407606b4e42fe72d34add8037 /src/whisper.tar.gz
RUN tar -xzf /src/whisper.tar.gz -C /src \
    && cmake -S /src/whisper.cpp-d1be6fde11ac6e0407606b4e42fe72d34add8037 -B /src/build \
       -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_CURL=OFF \
    && cmake --build /src/build --target whisper-cli -j1

FROM runtime AS analysis-local-runtime
COPY --from=whisper-build /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
CMD ["node", "apps/autoclipper-content-analysis-service/dist/main.js"]

FROM runtime AS verification
COPY --from=build --chown=node:node /app/tests ./tests
CMD ["node", "--test", "--test-concurrency=1", "tests/integration/*.test.mjs"]
