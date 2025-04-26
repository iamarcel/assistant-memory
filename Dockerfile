FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- Dependencies Stage ---
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Build Stage ---
FROM deps AS build
WORKDIR /app
COPY . .

RUN pnpm run build

# --- Final Application Stage ---
FROM base AS app
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle ./drizzle

ENV PORT=${PORT:-8000}
EXPOSE ${PORT}
CMD [ "node", "./.output/server/index.mjs" ]