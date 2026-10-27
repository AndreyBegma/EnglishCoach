FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY src ./src
COPY locales ./locales
COPY skills ./skills
# Boot runs scripts/entrypoint.sh: migrations from drizzle/, then the seeds (dictionary + seed/).
COPY drizzle ./drizzle
COPY seed ./seed
COPY data/words ./data/words
COPY data/grammar ./data/grammar
COPY data/pronunciation ./data/pronunciation
COPY scripts/entrypoint.sh scripts/entrypoint-migrate.ts scripts/seed.ts scripts/import-pronunciation.ts ./scripts/
# Owned by `bun` so a fresh tts-cache volume is writable.
RUN mkdir -p data/tts && chown bun:bun data/tts
USER bun
EXPOSE 18740
ENTRYPOINT ["sh", "/app/scripts/entrypoint.sh"]
CMD ["bun", "src/index.ts"]
