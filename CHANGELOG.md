# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted Jobven MCP server, serving the five captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `search_jobs`, `get_job`, `search_companies`, `get_company`, and `webhook_example`. Job and company lookups count toward the caller's own monthly allowance per the captured descriptions, and `webhook_example` returns a sample delivery signed with an example secret; no apply, submit, purchase or key-minting tool is part of this surface.
- Upstream results pass through verbatim; upstream failures surface as `jobhunt error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `JOBVEN_MCP_URL`; when `JOBVEN_API_KEY` is set it is sent as an `X-API-Key` header.
