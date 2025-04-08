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
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Build Stage ---
FROM deps AS build
COPY . /app

RUN pnpm run build

# --- Final Application Stage ---
FROM build AS app
WORKDIR /app
COPY --from=deps /app/package.json /app/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile
COPY --from=build /app/.output ./.output
RUN mkdir -p ./drizzle # Ensure migrations dir exists before copy
COPY --from=build /app/drizzle ./drizzle

ENV PORT=${PORT:-8000}
EXPOSE ${PORT}
CMD [ "node", "./.output/server/index.mjs" ]