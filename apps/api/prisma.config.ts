import { defineConfig, env } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // no .env file present -- fine in environments where real env vars are set directly
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
