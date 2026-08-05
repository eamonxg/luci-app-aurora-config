// Test paths resolve from this file, never from process.cwd(): `pnpm test` runs
// with cwd=.dev while most of what these tests assert about lives at the repo
// root. `repo` addresses the repo root; `src` addresses the JS sources, which
// are what a human edits -- assert against src, not against the built artifacts
// under htdocs, unless the artifact itself is the thing under test.
import { fileURLToPath } from "node:url";

export const repo = (relPath) =>
  fileURLToPath(new URL(`../../${relPath}`, import.meta.url));

// Deliberately not called `src`: almost every test in here already binds
// `const src = await readFile(...)`, which would shadow the helper and turn a
// path lookup into "src is not a function" halfway down a file.
export const srcPath = (relPath) =>
  fileURLToPath(new URL(`../src/resource/${relPath}`, import.meta.url));
