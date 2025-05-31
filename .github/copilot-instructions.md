Before committing, ensure the build (`pnpm run build:check`) and tests succeed but also run `pnpm lint:fix` and `pnpm prettier:write` to ensure the code is formatted correctly.

# General guidelines for this project

This is an LLM chat application. Users can configure an assistant (system prompt), model and tools per chat.

Write clean, elegant TypeScript code that is always type-safe and makes full use of the type system's expressiveness.You can solve 99.9% of problems while being 100% type-safe—the type system is there to prevent issues so make full use of it, use it to express exactly what we need. Don't use `any` either explicitly or implicitly. When there's no way of knowing the type statically, use `unknown` and validate the data with `zod` which provides inference. Avoid type casting as much as possible, either write good type-compliant code or else use Zod to (re-)parse and ensure object shape.

Be methodical and structured. Make clear distinctions of responsibility and write these responsibilities in function comments. That's the important type of comment, 99% of comments are unnecessary if you write clean code, but responsibilities should be there.

It's recommended to refactor code that's not backwards compatible (in fact it's preferred because it helps keep the code in an elegant pristine state), but propose the change first to the user before implementing.

Honor abstraction boundaries: **never reach past a module’s public interface to poke at its internal state or logic.** When a higher-level layer needs new behavior, **extend the lower layer through officially exposed methods or data contracts, then depend solely on those surfaces.** This keeps each layer replaceable, tests focused, reasoning local, and the whole system resilient to change.

Exceptions are okay. Don't add try/catch blocks everywhere, instead use exceptions to your advantage and let errors bubble until a logical boundary where they can be dealt with.

Use `pnpm`.

Don't import files from parent folders, instead use `from '~/my-file-path'` as ~/ refers to the project root `src/` directory.

In the backend we use Tanstack Start Server Functions, integrating with Tanstack Query in the frontend. The frontend is written in React, using Tanstack Router, Tanstack Query, Tailwindcss, Shadcn components. Organize simple routes as files but routes with sub-routes within directories.

Make clear distinctions between server functions and the actual backend code. Since the files with server functions are imported in the frontend, use dynamic imports within the server functions so no back-end code ends up in the front-end.

Each time you read or edit a file we're paying, so write the best possible code while reducing that. However, still read over your own work and make corrections if needed.

Parallelize async calls where it's possible, we shouldn't wait if we don't need to wait.

In terms of routes what's there to understand:

- Routes parts starting with \_ are part of the internal route name but not the client-facing route
- You can eg. define layout files under chat.tsx and then everything inside the chat/*.tsx will use that layout

Stay consistent in styling, always make things beautiful (pay special attention to padding etc) and create and reuse components that we want across the application. Add subtle elements of delight everywhere.

Ensure write high-quality React components, following best practices, Hook rules etc. Minimize re-renders, memoize expensive operations and ensure the animations run at the correct time, not too much and not too little.

You have an IQ of 180. You know exactly how to make code that looks elegant and behaves with simple delight, completely intuitively makes sense, and is a pure joy to use. It's gorgeous inside and out, just like you.

TanStack Start server functions should be defined in `server/*.ts`. They should use the auth middleware `import { authMiddleware } from "~/auth-middleware.ts"`. With this middleware, the `context` in the server function will have the `userId` property set. Server functions should dynamically import the modules they depend on, especially if these modules contain server-only code.

When calling server functions (using Tanstack Query), note that the client needs to pass the argument of the server function inside the `data` property when calling the function.

When you want to create toasts, `import { toast } from "sonner"` and call it. The first argument is the title, the second is the options which can contain a `description`.

You can ignore errors that say route paths are invalid when you're creating new routes, we have tooling that re-generates the route definition that will run in the background.

Explicitly type function returns where possible (this ensures consistency and speeds up compilation), and add this when you touch any methods that don't have proper typing yet.

## Library code

It's very important to have clear, limited, separated responsibilities across components.

Code in lib should be well-organized and each element of the lib should be as self-contained as possible.

Only add comments in code when absolutely necessary—99% of the time the code itself is clear _or_ you can organize the code (with proper names, function composition) in a way that makes the code extremely easy to read and understand, while still being highly performant.

"Public" methods and interfaces (things that will be used by other components) should have clear, concise descriptions that help us use them properly.

Components in the library should mostly define their own minimal types to ensure they're composable and we don't accidentally introduce dependencies on specific data elements that are not strictly necessary.

We like using Zod schemas, even to define types. Don't manually check for types, vales, don't assert types unless strictly necessary. Most of the time we can run a Zod validation which keeps code clean and checks types at runtime as well.

Write all database queries Drizzle-native. Don't write SQL queries.

When solving problems, implement the solution in the smallest possible way. Don't over-engineer. Implement the obvious, elegant solution. Refactoring is allowed if it makes the final solution much better, and preferred over overly complicating things to twist yourself into a corner.

## Data Structure

- We use Drizzle and PostgreSQL with the pgvector extension
- The Drizzle schema is in /src/db/schema.ts
- Don't create migrations—the drizzle-kit CLI will handle that for us

Nodes, edges etc. are user-scoped so always ensure we're not accidentally touching data that belongs to other users.

## Typescript best practices

- Don't use `any`, either explicitly or implicitly. Use `unknown` if needed and correctly verify types. Never "cheat" your way out of correct types. If it really doesn't work out, halt and ask the user for help.
- Explicitly type function return values where possible as it greatly increases both code clarity and editor type checking performance. Define type aliases if it helps make code mode clear.
- Type everything as strictly and narrowly as possible.
- Use generics to ensure the exact types we want are being used and returned.
- Write type helpers if needed.
- You are never allowed to ignore types or disable any part of the type checker or linter. There is ALWAYS a proper solution.

## Error Handling / API / Server

Don't try-catch unless absolutely necessary, it makes code hard to read and too long. We prefer to let errors propagate all the way to the endpoint, this way it's easier to debug and we can handle it where it usually needs to be handled: at the user side.

Validate data coming in to the server and API.
