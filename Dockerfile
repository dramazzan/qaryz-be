# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY . .
RUN DATABASE_URL="mongodb://127.0.0.1:27017/qaryz" npm run prisma:generate

EXPOSE 4000

CMD ["npm", "run", "start:api"]
