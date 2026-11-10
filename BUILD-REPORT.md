# BUILD REPORT — jobhunt

Rebuild of `com.jobven/jobven` v1.0.0 (remote-only)
as `@reneturcios/jobhunt` 0.1.0 / `io.github.CloudCorpRecords/jobhunt`.
**Full surface built: all 5 captured tools (5/5).**

## Fixture conflicts

**None.** The spec, the brief, and the fixture agree on the five tool
names and their required fields. Required fields as served, taken from
the fixture (`harness/fixtures/jobven-tools-original.json`):

- `search_jobs` — NO `required` key in its schema (the key is absent, not empty)
- `get_job` — required: `id`
- `search_companies` — NO `required` key in its schema (the key is absent, not empty)
- `get_company` — required: `id`
- `webhook_example` — required: `event`, `language`

The fixture's tool literals (name, title, description, inputSchema —
including the `$schema` key each captured inputSchema carries) are
served verbatim from `src/forward.ts`; the literals were generated
programmatically from the fixture JSON (parsed and re-serialised by
`/tmp/b39-jobhunt-gen.py`, not retyped) and verified by the
registration-integrity test (served tools/list deep-equals the
fixture's 5 tool objects, in order) and again by the parity harness.

Judgment calls recorded in the spec, followed here: `get_job` and
`get_company` state they count toward the monthly allowance —
metering on the caller's own pre-existing account; the 5-tool surface
holds no purchase, top-up, checkout or key-minting tool, so the
surface is built in full (the appindex precedent). `webhook_example`
returns a sample webhook delivery signed with an example secret plus
verifier code — a deterministic sample generator; it sends nothing
and signs nothing real. No tool applies, submits, messages or pays.

## What was built

All 19 factory files under `builds/jobhunt/`:

- `package.json` (`@reneturcios/jobhunt` 0.1.0, bin
  `jobhunt` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 78-char string
  "Search job postings and employer profiles collected from company career sites.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/jobhunt:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/jobhunt"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/jobhunt`, smoke assertion on server name
  `jobhunt`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://api.jobven.com/mcp` (pinned),
  overridable via `JOBVEN_MCP_URL` (LABELLED RECONSTRUCTION).
  tools/call is forwarded as a streamable-HTTP JSON-RPC client:
  initialize (protocolVersion `2025-03-26`, clientInfo `jobhunt`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `JOBVEN_API_KEY` is set, an `X-API-Key: <value>` header is
  sent on every upstream request (header name pinned by the registry
  record's own remote declaration, which declares a required secret
  `X-API-Key` header; the env name and the env forwarding are
  LABELLED RECONSTRUCTIONS — the record pins no package env name and
  the capture was keyless). When unset, no key header is sent. No
  `Authorization` header is sent in either case. Both branches are
  covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `jobhunt error:` text results
  (LABELLED RECONSTRUCTION).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration (per the task brief, overriding TEMPLATE.md §2 item 12).
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed beyond the coordinator's tools/list
  captures.

## Labelled reconstructions (from the spec's Wire section)

- `JOBVEN_MCP_URL` env override of the pinned endpoint
  `https://api.jobven.com/mcp`.
- `JOBVEN_API_KEY` env name and the forwarding of its value as
  `X-API-Key: <value>` (header name pinned by the registry record;
  env name pinned by nothing, capture keyless).
- The `jobhunt error:` failure rendering for upstream failures.

## Lockfile (Route 3, clean from birth)

Generated in the build dir with no `node_modules` present and no
pre-existing lockfile:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/jobhunt`,
**128 package entries**, sha256
`fb3c9c1251910679e1e5f24958e091490d9d33902e3e9e809ec742d2f22018a3`.
Then `npm install --offline --ignore-scripts` in the build dir for
`node_modules`.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js, forward.js, mcp.js, all
  non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **59 tests, 59 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 5 tool
  objects, names in order, exactly the fixture's keys including
  `title`, `$schema` key per inputSchema, required fields per tool
  including the absent-`required` cases, every property key in order
  for all 5 tools, enum + scalar-constraint literals, allowance
  wording, isKnownTool; session establishment/reuse/session-id
  handling, clientInfo/protocol version; env URL override, explicit
  url override, explicit-over-env precedence, blank-env fallback;
  X-API-Key header present on every request when the key is set /
  absent when unset / no Authorization header in either case;
  verbatim argument forwarding for all 5 tools incl. fully-specified
  search_jobs and search_companies calls; verbatim result
  pass-through incl. upstream isError and SSE; JSON-RPC/init/
  malformed/no-result/HTTP/throw/timeout failures → `jobhunt error:`;
  parseRpcBody JSON + SSE + matching-id + [DONE] cases; MCP-layer
  MethodNotFound / InvalidParams validation; CLI --version / -v /
  unknown exit 2 / bad-JSON exit 2 / `mcp extra` exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/jobven-tools-original.json --rebuild
  "stdio:node builds/jobhunt/dist/cli.js mcp" --out
  builds/jobhunt/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 5/5 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 78 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for jobhunt; only the
mechanics were patterned on the sibling imgpage build (same
forwarding-client class), and only the fixture's tool literals are
served verbatim.
