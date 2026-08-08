// Copies the *.schema.json files from src/ to dist/ after tsc runs.
// Plain Node fs calls instead of a shell `cp` — Windows cmd.exe has no cp,
// and this way the build script doesn't depend on which shell npm invokes.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const srcDir = "src";
const distDir = "dist";

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const schemaFiles = readdirSync(srcDir).filter((f) => f.endsWith(".schema.json"));
for (const file of schemaFiles) {
  copyFileSync(join(srcDir, file), join(distDir, file));
}

console.log(`Copied ${schemaFiles.length} schema file(s) to dist/`);