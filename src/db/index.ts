import * as schema from "./schema";
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "~/utils/env";

const db = drizzle({
  schema,
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: false,
  },
  casing: "snake_case",
});

export default db;
