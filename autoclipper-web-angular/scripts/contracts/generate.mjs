import openapiTS, { astToString } from "openapi-typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const upstream = new URL(
  "../../../autoclipper-project-documentation/contracts/gateway.openapi.json",
  import.meta.url,
);
const source = new URL('../../contracts/public-gateway.snapshot.json', import.meta.url);
if (process.argv.includes('--sync')) {
  const current = await readFile(upstream, 'utf8');
  JSON.parse(current);
  await mkdir(new URL('../../contracts/', import.meta.url), { recursive: true });
  await writeFile(source, current);
}
const data = await readFile(source, "utf8");
if (process.argv.includes('--check-upstream')) {
  if (data !== await readFile(upstream, 'utf8')) throw new Error('Public contract changed. Review it and run npm run contracts:sync.');
  console.log('Recorded public contract matches upstream.');
  process.exit(0);
}
const hash = createHash("sha256").update(data).digest("hex");
const ast = await openapiTS(JSON.parse(data));
await mkdir(new URL("../../src/app/core/contracts/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL(
    "../../src/app/core/contracts/gateway.generated.d.ts",
    import.meta.url,
  ),
  `// Generated from contracts/public-gateway.snapshot.json; SHA-256 ${hash}\n// Run npm run contracts. Do not edit manually.\n${astToString(ast)}`,
);
console.log(`Generated public gateway types (${hash.slice(0, 12)}).`);
