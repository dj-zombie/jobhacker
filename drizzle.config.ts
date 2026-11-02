import { defineConfig } from 'drizzle-kit';

const dbPath = process.env.DATABASE_PATH ?? './data/jobhacker.db';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: dbPath,
  },
  strict: true,
  verbose: true,
});
