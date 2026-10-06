// packages/api/src/server.ts
/**
 * Server entrypoint: builds the app, fails fast on pack errors, listens.
 */

import { buildApp } from "./app.js";
import { PackLoadError } from "./packLoader.js";

const PACK_PATH =
  process.env.CDS_PACK_PATH || "../knowledge-packs/cv-v1/dist/pack.json";
const PORT = Number(process.env.PORT) || 3000;

async function main() {
  let app;
  try {
    app = await buildApp({ packPath: PACK_PATH, logger: true });
  } catch (err) {
    if (err instanceof PackLoadError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`Server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();