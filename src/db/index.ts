import * as schema from "./schema";
import "dotenv/config";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { env } from "~/utils/env";

const db = drizzle({
  schema,
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: false,
  },
  casing: "snake_case",
});

export type DrizzleDB = NodePgDatabase<typeof schema>;

export default db;
