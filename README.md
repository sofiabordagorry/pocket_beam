# Pocket BEAM

Run Elixir and Ecto in your browser. No server, no install: the code compiles and
runs in your tab, on the real BEAM (Erlang/OTP 29) compiled to WebAssembly with
[Popcorn](https://github.com/software-mansion/popcorn).

**Elixir mode**

- The full language and standard library: processes, GenServers, supervisors,
  Regex, dates. Nothing is blocked, because nothing runs on a shared server.
- Compiler warnings, including **Elixir 1.20's type errors**, underlined in the
  editor.
- Infinite loops are stopped after 10 seconds without freezing the page.

**Ecto mode**

- Write schemas and a query: you get the **Postgres SQL** and its parameters.
  No database involved.
- End with a changeset: you see whether it is valid, its changes and its errors.

**Sharing**: the code is compressed into the link, so sharing needs no backend.

## Running it

You need Erlang 29.0.6 and Elixir 1.20.4 (pinned in `.tool-versions` for asdf)
and Node.

```sh
mix deps.get
cd assets
npm install
npm run dev        # http://localhost:5173
```

For a production build: `npm run build`, then serve `dist/` with these headers
(Popcorn needs them for `SharedArrayBuffer`):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`npm run preview` serves the build with those headers. Restart it after every
build: it does not pick up new files while running.

Tests run on the regular BEAM: `mix test`.

## How it works

```
PocketBeam.Supervisor
├─ PocketBeam.Server   receives "run" requests from the page (via Popcorn.Proxy)
│  └─ one Task per run, killed after 10 s
└─ Popcorn.Proxy
```

- `PocketBeam.Runner` evaluates the snippet one top-level expression at a time
  (like IEx), so a snippet can define `defmodule User` and use `%User{}` below.
  It captures stdout and the compiler diagnostics.
- `PocketBeam.SQL` turns an `Ecto.Query` into SQL the way `Repo.to_sql/2` does
  internally, without a `Repo` or a connection.
- `assets/src/main.js` is the page: CodeMirror, the output panel and the share
  link.

## Known issue: Popcorn's crypto runtime

Ecto depends on `:crypto`, so the app needs Popcorn's `crypto` runtime variant.
The Hex package of `popcorn 0.4.0-next.2` does not include that runtime's
manifest (the npm package does). `assets/scripts/crypto-runtime.mjs` copies it
from `node_modules` into `deps/popcorn` before every `dev` and `build`.
