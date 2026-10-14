import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/autoclipper-media-processing-service/src/infrastructure/schema.ts',
  out: './apps/autoclipper-media-processing-service/migrations'
});
