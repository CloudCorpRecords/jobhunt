# jobhunt

jobhunt is a small local bridge to the hosted Jobven
MCP server, which collects job postings and employer
profiles from company career sites. Through it you can
search openings with a broad filter set — title and
description phrases, remote type, experience level,
employment type, skills, industry, language, place,
salary range, sponsorship and posting dates — pick a
single posting to read in full, find employers by name,
open one employer's profile, or pull a sample webhook
delivery to test a receiver against.

This package searches nothing itself. It answers the
tool list locally, exactly as captured from the live
endpoint, and forwards each tool call upstream,
returning whatever comes back untouched. Per the
captured descriptions, jobs returned by a search and
single job or company lookups count toward the
monthly allowance on your own Jobven account, while
company searches are free. Nothing in this package can
apply for a job, submit an application, send a message,
start a checkout, or mint a key: it only reads through
the five calls below, plus the sample webhook example
which sends nothing and signs nothing real.

## Tools

- `search_jobs` — search Jobven job postings with the
  filters of `GET /v1/public/jobs`. Returns 10 jobs by
  default (at most 25) with a plain-text excerpt of
  each description; `get_job` has the full text. Pass
  `nextCursor` back as `cursor`, with the same filters,
  for the next page. Each job returned counts toward
  the monthly allowance. Every argument is optional:
  `q` (title words; ANDed in any order, `"double
  quotes"` for an exact phrase, `OR` for either side, a
  leading `-` to exclude; case-insensitive; does not
  search descriptions), `descriptionQuery` (whole-word
  phrase in descriptions, matched literally;
  case-insensitive; slower, pair with `postedAfter`),
  `remoteType` (`onsite`, `remote`, `hybrid`,
  `flexible`), `experienceLevel` (`entry`, `mid`,
  `senior`, `lead`, `executive`), `employmentType`
  (`full_time`, `part_time`, `contract`, `internship`,
  `seasonal`, `volunteer`, `temporary`, `per_diem`,
  `other`), `skills`, `industry`, `language` (ISO
  639-1 code), `location`, `country` (ISO 3166-1
  alpha-2; `XX` matches jobs with no location),
  `state`, `city`, `minSalary`, `maxSalary`,
  `salaryCurrency` (ISO 4217 code), `hasVisaSponsorship`,
  `hasRelocation`, `status` (`active`, the default, or
  `closed`), `postedAfter`, `postedBefore`,
  `listedAfter` (Unix seconds), `sortBy` (`postedAt`,
  `listedAt`, `title`, `company`), `order` (`ASC` or
  `DESC`, default `DESC`), `includeTotal`, `cursor`,
  and `limit` (1-25, default 10).
- `get_job` — one Jobven job posting by `id`, with the
  full description (`GET /v1/public/jobs/{id}`).
  Required: `id` (a job id from `search_jobs`, UUID
  form). Optional: `descriptionFormat` (`plain`, the
  default, or `markdown`). Counts as one job toward
  the monthly allowance.
- `search_companies` — find employers Jobven collects
  jobs from by name (`GET /v1/public/companies`).
  Returns `id`, `name` and `website`; `get_company`
  has the profile. Free: company searches do not count
  toward the allowance. Every argument is optional:
  `search` (name contains this text), `status`
  (`active` or `inactive`; both when unset),
  `isVerified`, `sortBy` (`name`, `foundedYear`,
  `totalJobsPosted`, `activeJobsCount`, `createdAt`),
  `sortOrder` (`ASC` or `DESC`), `page` (from 1), and
  `limit` (1-25, default 10).
- `get_company` — one employer's profile by `id`
  (`GET /v1/public/company-profiles/{id}`): what it
  does, industry, size, founding year, headquarters
  and social links. Required: `id` (a company id from
  `search_companies`). Counts as one toward the
  monthly allowance.
- `webhook_example` — a sample Jobven webhook delivery
  for one event: the raw body and headers exactly as a
  receiver gets them, signed with an example secret,
  plus the signature verifier from the webhook docs in
  TypeScript, Python or Go. The verifier accepts the
  sample, so a receiver can be tested end to end. No
  API call, no key needed, free. Required: `event`
  (`job.created`, `job.updated`, `job.closed`,
  `job.deleted`) and `language` (`typescript`,
  `python`, `go`).

## Configuration

- `JOBVEN_MCP_URL` (optional) — override the upstream
  endpoint. Defaults to `https://api.jobven.com/mcp`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `JOBVEN_API_KEY` (optional) — when set, every
  upstream request carries an `X-API-Key: <value>`
  header, for the caller's own Jobven API key. When it
  is not set, no key header is sent. (The header name
  is pinned by the original's registry record, which
  declares a required secret `X-API-Key` header; the
  record pins no package env name, so forwarding the
  key from this env var is a labelled reconstruction —
  the original surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session upstream: a JSON-RPC `initialize`
request (protocolVersion `2025-03-26`, clientInfo
name `jobhunt`), then a `notifications/initialized`
notification, then the `tools/call` request carrying
the caller's arguments unchanged. When the upstream
answers `initialize` with an `Mcp-Session-Id` header,
that value rides on every later request of the
session, which is reused for the life of the process.
Replies may arrive as plain JSON or as server-sent
events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `jobhunt error:` (this rendering is
this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/jobhunt search_jobs '{"q":"typescript","remoteType":["remote"]}'
npx @reneturcios/jobhunt get_job '{"id":"00000000-0000-0000-0000-000000000000"}'
npx @reneturcios/jobhunt search_companies '{"search":"acme"}'
npx @reneturcios/jobhunt get_company '{"id":42}'
npx @reneturcios/jobhunt webhook_example '{"event":"job.created","language":"python"}'
npx @reneturcios/jobhunt --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/jobhunt mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "jobhunt": {
      "command": "npx",
      "args": ["-y", "@reneturcios/jobhunt", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/jobhunt
docker run --rm ghcr.io/cloudcorprecords/jobhunt --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
