/**
 * jobhunt core: a forwarding client for the hosted
 * Jobven MCP server.
 *
 * No searching happens in this process. The tools/list
 * answer comes from the literal definitions below,
 * taken verbatim from a live capture of the upstream
 * server (name, title, description and inputSchema
 * exactly as captured, including the `$schema` key each
 * inputSchema carries). A tools/call travels upstream
 * over a streamable-HTTP JSON-RPC session: an
 * initialize POST, a notifications/initialized POST,
 * then the tools/call POST, carrying the
 * Mcp-Session-Id response header on later requests
 * when the upstream issues one. The session opens
 * lazily on the first forwarded call and is reused for
 * the client's life.
 *
 * The endpoint is pinned to https://api.jobven.com/mcp
 * and may be replaced with the JOBVEN_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). When JOBVEN_API_KEY is set, every
 * upstream request carries an `X-API-Key: <value>`
 * header (the header name is pinned by the registry
 * record's own remote declaration, which declares a
 * required secret `X-API-Key` header; forwarding the
 * key from this env var is a labelled reconstruction,
 * as the record pins no package env name and the
 * capture was taken keyless). When it is unset, no key
 * header goes out.
 *
 * A successful upstream result is returned exactly as
 * received, isError flag and extra fields included.
 * Failures — an upstream JSON-RPC error, a non-2xx
 * status, a body that cannot be parsed, or a fetch that
 * throws or times out — become an isError result whose
 * text begins with `jobhunt error:` (that rendering is
 * a labelled reconstruction). Replies may be plain JSON
 * or SSE (`data:` lines); the JSON-RPC message whose id
 * matches the request wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://api.jobven.com/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/jobven-tools-original.json;             */
/* generated programmatically by parsing and re-serialising the        */
/* fixture JSON with /tmp/b39-jobhunt-gen.py, never retyped)           */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "search_jobs",
    "title": "Search jobs",
    "description": "Search Jobven job postings with the filters of GET /v1/public/jobs. Returns 10 jobs by default (at most 25) with a plain-text excerpt of each description; get_job has the full text. Pass nextCursor back as cursor, with the same filters, for the next page. Each job returned counts toward the monthly allowance.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "q": {
          "description": "Search job titles by whole word. Words are ANDed in any order; \"double quotes\" match an exact phrase, OR matches either side, and a leading - excludes a word. Case-insensitive. Does not search descriptions (see descriptionQuery).",
          "type": "string",
          "maxLength": 200
        },
        "descriptionQuery": {
          "description": "Search job descriptions for a whole-word phrase, matched literally, case-insensitive. Slower than the other filters; pair it with postedAfter.",
          "type": "string",
          "maxLength": 200
        },
        "remoteType": {
          "description": "Remote type, any of",
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "onsite",
              "remote",
              "hybrid",
              "flexible"
            ]
          }
        },
        "experienceLevel": {
          "description": "Experience level, any of",
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "entry",
              "mid",
              "senior",
              "lead",
              "executive"
            ]
          }
        },
        "employmentType": {
          "description": "Employment type, any of",
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "full_time",
              "part_time",
              "contract",
              "internship",
              "seasonal",
              "volunteer",
              "temporary",
              "per_diem",
              "other"
            ]
          }
        },
        "skills": {
          "description": "Skills, any of (up to 10), e.g. [\"typescript\", \"react\"]",
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "industry": {
          "description": "Industries, any of (up to 10)",
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100
          }
        },
        "language": {
          "description": "Required spoken language, ISO 639-1 code, e.g. \"fr\"",
          "type": "string",
          "minLength": 2,
          "maxLength": 2
        },
        "location": {
          "description": "Free-text location: city, region or country",
          "type": "string",
          "maxLength": 200
        },
        "country": {
          "description": "ISO 3166-1 alpha-2 country code, e.g. \"US\", \"CA\", \"GB\". \"XX\" matches jobs with no location at all.",
          "type": "string",
          "maxLength": 2
        },
        "state": {
          "description": "State, province or region, comma-separated: full name (\"Ontario\") or, for the US and Canada, the postal code (\"ON\")",
          "type": "string",
          "maxLength": 500
        },
        "city": {
          "description": "City, comma-separated; case and accents are ignored",
          "type": "string",
          "maxLength": 500
        },
        "minSalary": {
          "description": "Minimum yearly pay; hourly, daily, weekly and monthly pay is compared per year. In each job's own currency unless salaryCurrency is set",
          "type": "number",
          "minimum": 0
        },
        "maxSalary": {
          "description": "Maximum yearly starting pay, as minSalary",
          "type": "number",
          "minimum": 0
        },
        "salaryCurrency": {
          "description": "ISO 4217 currency code of the salary, e.g. USD, EUR, PLN",
          "type": "string",
          "pattern": "^[A-Za-z]{3}$"
        },
        "hasVisaSponsorship": {
          "description": "true: postings that offer visa sponsorship; false: postings that say they do not",
          "type": "boolean"
        },
        "hasRelocation": {
          "description": "true: postings that offer relocation help; false: postings that say they do not",
          "type": "boolean"
        },
        "status": {
          "description": "\"active\" (the default) or \"closed\"",
          "type": "string",
          "enum": [
            "active",
            "closed"
          ]
        },
        "postedAfter": {
          "description": "Posted at or after (Unix seconds)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "postedBefore": {
          "description": "Posted before (Unix seconds)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "listedAfter": {
          "description": "Listed at or after (Unix seconds), by listedAt: for incremental sync",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "sortBy": {
          "description": "Sort field (default postedAt)",
          "type": "string",
          "enum": [
            "postedAt",
            "listedAt",
            "title",
            "company"
          ]
        },
        "order": {
          "description": "Default DESC",
          "type": "string",
          "enum": [
            "ASC",
            "DESC"
          ]
        },
        "includeTotal": {
          "description": "Also count every match (slower)",
          "type": "boolean"
        },
        "cursor": {
          "description": "nextCursor from the previous search_jobs result, same filters",
          "type": "string",
          "maxLength": 1000
        },
        "limit": {
          "description": "Jobs per page, default 10, at most 25",
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        }
      }
    }
  },
  {
    "name": "get_job",
    "title": "Get a job",
    "description": "One Jobven job posting by id, with the full description (GET /v1/public/jobs/{id}). Counts as one job toward the monthly allowance.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
          "description": "A job id from search_jobs"
        },
        "descriptionFormat": {
          "description": "Description as plain text (default) or markdown",
          "type": "string",
          "enum": [
            "plain",
            "markdown"
          ]
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "search_companies",
    "title": "Search companies",
    "description": "Find employers Jobven collects jobs from by name (GET /v1/public/companies). Returns id, name and website; get_company has the profile. Free: company searches do not count toward the allowance.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "search": {
          "description": "Company name contains this text",
          "type": "string",
          "maxLength": 200
        },
        "status": {
          "description": "\"active\" or \"inactive\"; both when unset",
          "type": "string",
          "enum": [
            "active",
            "inactive"
          ]
        },
        "isVerified": {
          "description": "Only verified, or only unverified, companies",
          "type": "boolean"
        },
        "sortBy": {
          "description": "Sort field",
          "type": "string",
          "enum": [
            "name",
            "foundedYear",
            "totalJobsPosted",
            "activeJobsCount",
            "createdAt"
          ]
        },
        "sortOrder": {
          "type": "string",
          "enum": [
            "ASC",
            "DESC"
          ]
        },
        "page": {
          "description": "Page number, from 1",
          "type": "integer",
          "minimum": 1,
          "maximum": 100000
        },
        "limit": {
          "description": "Companies per page, default 10, at most 25",
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        }
      }
    }
  },
  {
    "name": "get_company",
    "title": "Get a company",
    "description": "One employer's profile by id (GET /v1/public/company-profiles/{id}): what it does, industry, size, founding year, headquarters and social links. Counts as one toward the monthly allowance.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "id": {
          "type": "integer",
          "minimum": 1,
          "maximum": 2147483647,
          "description": "A company id from search_companies"
        }
      },
      "required": [
        "id"
      ]
    }
  },
  {
    "name": "webhook_example",
    "title": "Webhook example",
    "description": "A sample Jobven webhook delivery for one event: the raw body and headers exactly as a receiver gets them, signed with an example secret, plus the signature verifier from the webhook docs in TypeScript, Python or Go. The verifier accepts the sample, so a receiver can be tested end to end. No API call, no key needed, free.",
    "inputSchema": {
      "type": "object",
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "properties": {
        "event": {
          "type": "string",
          "enum": [
            "job.created",
            "job.updated",
            "job.closed",
            "job.deleted"
          ],
          "description": "The event to show a delivery of"
        },
        "language": {
          "type": "string",
          "enum": [
            "typescript",
            "python",
            "go"
          ],
          "description": "Language of the signature verifier"
        }
      },
      "required": [
        "event",
        "language"
      ]
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` belongs to the captured surface. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `jobhunt error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Read a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * present, otherwise the last parseable message, otherwise
 * null when nothing in the body parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not a JSON payload; skip this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client that holds a single upstream
 * session, opened lazily on first use and reused from
 * then on (for the process lifetime in the MCP server,
 * or for a single invocation in the CLI).
 */
export class JobhuntClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).JOBVEN_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).JOBVEN_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["X-API-Key"] = key;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "jobhunt", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // Nothing needed from the notification response body.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Hand the upstream result back exactly as received.
    return result;
  }
}

/** Build a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): JobhuntClient {
  return new JobhuntClient(deps);
}

/** One-shot helper: a fresh client for a single call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new JobhuntClient(deps).callTool(name, args);
}
