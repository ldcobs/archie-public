FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ && npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Pre-built image path (Option B): bake __ARCHIE_*__ sentinels instead of a
# customer's real values, so one image serves every install (docker-entrypoint.sh
# swaps them at runtime). Default 0 = on-box build, uses the staged .env.production.
ARG ARCHIE_PREBUILT=0
RUN if [ "$ARCHIE_PREBUILT" = "1" ]; then cp .env.production.sentinel .env.production; fi
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Native module for better-sqlite3 (not bundled by Next.js standalone)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# nodemailer is externalized (not bundled) by the standalone build and the trace
# misses it; copy it explicitly. Zero runtime dependencies, so a single copy suffices.
COPY --from=builder /app/node_modules/nodemailer ./node_modules/nodemailer

# Runtime sentinel-swap wrapper. A no-op when values were baked at build (on-box
# path); does the per-install injection for the pre-built image.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
