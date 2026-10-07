// Workaround for popcorn 0.4.0-next.2: the Hex package ships only the `core`
// runtime manifest, but Ecto needs the `crypto` runtime variant. The npm
// package does ship it, so copy it to where `mix popcorn.cook` looks for it.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const assets = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(assets, "node_modules/@swmansion/popcorn/dist/runtimes/crypto");
const to = resolve(assets, "../deps/popcorn/priv/static/runtimes/crypto");

if (!existsSync(from)) {
  console.error("crypto runtime not found in node_modules. Run `npm install` first.");
  process.exit(1);
}
if (!existsSync(resolve(assets, "../deps/popcorn"))) {
  console.error("deps/popcorn not found. Run `mix deps.get` in the project root first.");
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("popcorn crypto runtime ready");
