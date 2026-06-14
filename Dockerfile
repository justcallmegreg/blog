# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app
# Baked into /version (astro.config.mjs reads SOURCE_COMMIT); .git is not in the
# build context, so the commit is passed in as a build-arg.
ARG SOURCE_COMMIT=unknown
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache git
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV CONFIG_PATH=/config/config.yaml
ENV CACHE_DIR=/tmp/content-cache
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /tmp/content-cache && chown -R app:app /app /tmp/content-cache
USER app
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
