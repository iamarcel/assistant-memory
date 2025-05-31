mindset
- write fully type-safe, elegant TypeScript
- prefer obvious, minimal solutions over clever complexity
- refactor freely but propose breaking changes first

repo and tooling
- use pnpm for every script
- project root is src/, import with `~/path`
- read or edit as few files as possible; self-review before commit
- route generator runs in background; ignore interim path warnings

project architecture
- LLM chat app: configurable assistant, model and tools per chat
- backend: TanStack Start server functions (`server/*.ts`) + Drizzle/PostgreSQL (pgvector)
- frontend: React + TanStack Router + TanStack Query + Tailwindcss + shadcn/ui

abstraction boundaries
- depend only on a module’s public surface; extend that surface when new behaviour is needed
- keep strict separation of concerns; names should be precise, clear, self-documenting

typescript
- never use any; use unknown + zod for runtime shape checks
- narrow, explicit return types; add where missing
- no type casting; worst-case through a zod schema
- write helper generics when it clarifies intent

tanstack start server functions
- files live under `server/*.ts`
- apply middleware via an array in the config; handler signature is  
  `({ data, context }) => { … }`
- `context` contains `userId` from `authMiddleware`
- validate `data` with a zod schema (preferred) or a custom function
- dynamically import server-only modules
- client must call `serverFn({ data: <payload> })`

error handling
- let exceptions bubble to a single boundary
- avoid blanket try/catch

frontend
- memoize expensive work, avoid needless re-renders
- animate only when it adds value

library code
- each file owns a single concern
- document why a module exists in a JSDoc header; no redundant inline comments
- public APIs get concise usage notes
- favour zod schemas over manual guards

data access
- write Drizzle-native queries only
- nodes/edges are user-scoped; never touch others’ data

async
- parallelise independent awaits; avoid serial chains

testing
- add tests for critical features or those with lots of edge cases
- write testable code; it's a good check for design and abstraction quality

branch & pr
- branch names: feat/, fix/, chore/
- PR description template: what & why, how to test, checklist (build, tests, lint, prettier, coverage)
- commit messages: concise, imperative, structured with `<emoji> <type>(<scope>): <subject>`  
  - emojis: 🐛 fix, ✨ feat, 🔧 chore, 📚 docs, ✅ test, 🎨 style, ♻️ refactor, 🚀 perf, 🔒 security; be creative

validation checklist (run before commit)
1. `pnpm run build:check`
2. `pnpm test --run`
3. `pnpm lint:fix && pnpm prettier:write`