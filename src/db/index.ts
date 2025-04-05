import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

const db = drizzle({
  connection: {
    connectionString: process.env.DATABASE_URL!,
    ssl: false,
  },
  casing: "snake_case",
});

export default db;
