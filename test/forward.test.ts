import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  JobhuntClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * All tests run against a stubbed JSON-RPC upstream that
 * implements the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, and the real Jobven endpoint is
 * never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/jobven-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const SEARCH_JOBS = "search_jobs";
const GET_JOB = "get_job";
const SEARCH_COMPANIES = "search_companies";
const GET_COMPANY = "get_company";
const WEBHOOK_EXAMPLE = "webhook_example";

const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"jobs\":[]}" }],
  structuredContent: { jobs: [] },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-abc" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "jobven", version: "1.0.0" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new JobhuntClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

function propsOf(tool: ToolDef): Record<string, Record<string, unknown>> {
  return (
    tool.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
    }
  ).properties;
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 5 tools, deep-equal", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 5);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 5 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, [
      "search_jobs",
      "get_job",
      "search_companies",
      "get_company",
      "webhook_example",
    ]);
  });

  it("carries exactly the fixture's keys on each tool, including title", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });

  it("carries the fixture's titles verbatim", () => {
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      ["Search jobs", "Get a job", "Search companies", "Get a company", "Webhook example"],
    );
  });

  it("carries the $schema key in every inputSchema, verbatim", () => {
    for (const tool of TOOL_DEFS) {
      assert.equal(
        (tool.inputSchema as { $schema?: unknown }).$schema,
        "https://json-schema.org/draft/2020-12/schema",
      );
      assert.equal((tool.inputSchema as { type?: unknown }).type, "object");
    }
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const requiredOf = (i: number) =>
      (TOOL_DEFS[i].inputSchema as { required?: string[] }).required;
    assert.equal("required" in TOOL_DEFS[0].inputSchema, false);
    assert.deepEqual(requiredOf(1), ["id"]);
    assert.equal("required" in TOOL_DEFS[2].inputSchema, false);
    assert.deepEqual(requiredOf(3), ["id"]);
    assert.deepEqual(requiredOf(4), ["event", "language"]);
  });

  it("carries every fixture property, in order, for all 5 tools", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < 5; i += 1) {
      const served = Object.keys(propsOf(TOOL_DEFS[i]));
      const expected = Object.keys(propsOf(fixture.tools[i]));
      assert.deepEqual(served, expected);
    }
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[0])), [
      "q", "descriptionQuery", "remoteType", "experienceLevel",
      "employmentType", "skills", "industry", "language", "location",
      "country", "state", "city", "minSalary", "maxSalary",
      "salaryCurrency", "hasVisaSponsorship", "hasRelocation", "status",
      "postedAfter", "postedBefore", "listedAfter", "sortBy", "order",
      "includeTotal", "cursor", "limit",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[1])), ["id", "descriptionFormat"]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[2])), [
      "search", "status", "isVerified", "sortBy", "sortOrder", "page", "limit",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[3])), ["id"]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[4])), ["event", "language"]);
  });

  it("carries the fixture's search_jobs enums verbatim", () => {
    const props = propsOf(TOOL_DEFS[0]);
    assert.deepEqual((props.remoteType.items as { enum: string[] }).enum, [
      "onsite", "remote", "hybrid", "flexible",
    ]);
    assert.deepEqual((props.experienceLevel.items as { enum: string[] }).enum, [
      "entry", "mid", "senior", "lead", "executive",
    ]);
    assert.deepEqual((props.employmentType.items as { enum: string[] }).enum, [
      "full_time", "part_time", "contract", "internship", "seasonal",
      "volunteer", "temporary", "per_diem", "other",
    ]);
    assert.deepEqual(props.status.enum, ["active", "closed"]);
    assert.deepEqual(props.sortBy.enum, ["postedAt", "listedAt", "title", "company"]);
    assert.deepEqual(props.order.enum, ["ASC", "DESC"]);
  });

  it("carries the fixture's scalar constraints for search_jobs", () => {
    const props = propsOf(TOOL_DEFS[0]);
    assert.equal(props.q.type, "string");
    assert.equal(props.q.maxLength, 200);
    assert.equal(props.language.minLength, 2);
    assert.equal(props.language.maxLength, 2);
    assert.equal(props.minSalary.type, "number");
    assert.equal(props.hasVisaSponsorship.type, "boolean");
    assert.equal(props.postedAfter.type, "integer");
    assert.equal(props.limit.minimum, 1);
    assert.equal(props.limit.maximum, 25);
    assert.equal(props.salaryCurrency.pattern, "^[A-Za-z]{3}$");
  });

  it("carries the fixture's get_job and get_company id shapes", () => {
    const jobProps = propsOf(TOOL_DEFS[1]);
    assert.equal(jobProps.id.type, "string");
    assert.equal(jobProps.id.format, "uuid");
    assert.deepEqual(jobProps.descriptionFormat.enum, ["plain", "markdown"]);
    const companyProps = propsOf(TOOL_DEFS[3]);
    assert.equal(companyProps.id.type, "integer");
    assert.equal(companyProps.id.minimum, 1);
    assert.equal(companyProps.id.maximum, 2147483647);
  });

  it("carries the fixture's search_companies and webhook_example enums", () => {
    const companyProps = propsOf(TOOL_DEFS[2]);
    assert.deepEqual(companyProps.status.enum, ["active", "inactive"]);
    assert.deepEqual(companyProps.sortBy.enum, [
      "name", "foundedYear", "totalJobsPosted", "activeJobsCount", "createdAt",
    ]);
    assert.deepEqual(companyProps.sortOrder.enum, ["ASC", "DESC"]);
    const hookProps = propsOf(TOOL_DEFS[4]);
    assert.deepEqual(hookProps.event.enum, [
      "job.created", "job.updated", "job.closed", "job.deleted",
    ]);
    assert.deepEqual(hookProps.language.enum, ["typescript", "python", "go"]);
  });

  it("carries the fixture's allowance wording in the metering descriptions", () => {
    assert.match(TOOL_DEFS[0].description, /counts toward the monthly allowance/);
    assert.match(TOOL_DEFS[1].description, /Counts as one job toward the monthly allowance/);
    assert.match(TOOL_DEFS[3].description, /Counts as one toward the monthly allowance/);
    assert.match(TOOL_DEFS[2].description, /do not count toward the allowance/);
    assert.match(TOOL_DEFS[4].description, /No API call, no key needed, free\./);
  });

  it("isKnownTool recognises the 5 built tools and rejects others", () => {
    for (const name of [SEARCH_JOBS, GET_JOB, SEARCH_COMPANIES, GET_COMPANY, WEBHOOK_EXAMPLE]) {
      assert.equal(isKnownTool(name), true);
    }
    assert.equal(isKnownTool("apply_job"), false);
    assert.equal(isKnownTool(""), false);
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(DEFAULT_ENDPOINT_URL, "https://api.jobven.com/mcp");
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(call.headers["Accept"], "application/json, text/event-stream");
    }
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-abc");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-abc");
  });

  it("sends clientInfo name jobhunt and the pinned protocol version on initialize", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(GET_COMPANY, { id: 7 });
    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.equal(PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, { name: "jobhunt", version: VERSION });
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH_JOBS, {});
    await c.callTool(SEARCH_COMPANIES, {});
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-abc");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the JOBVEN_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new JobhuntClient({
      fetchFn: upstream.fetchFn,
      env: { JOBVEN_MCP_URL: "https://staging.example.com/mcp" },
    });
    await c.callTool(SEARCH_JOBS, {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool(GET_JOB, { id: "00000000-0000-0000-0000-000000000000" });
    assert.ok(upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"));
  });

  it("prefers an explicit url override over the env override", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { JOBVEN_MCP_URL: "https://env.example.com/mcp" },
      url: "https://explicit.example.com/mcp",
    });
    await c.callTool(SEARCH_JOBS, {});
    assert.ok(
      upstream.calls.every((call) => call.url === "https://explicit.example.com/mcp"),
    );
  });

  it("falls back to the pinned endpoint when the env override is blank", async () => {
    const upstream = makeUpstream();
    const c = new JobhuntClient({
      fetchFn: upstream.fetchFn,
      env: { JOBVEN_MCP_URL: "   " },
    });
    await c.callTool(SEARCH_JOBS, {});
    assert.ok(upstream.calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
  });
});

/* ------------------------------------------------------------------ */

describe("upstream key header", () => {
  it("sends X-API-Key on every request when JOBVEN_API_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new JobhuntClient({
      fetchFn: upstream.fetchFn,
      env: { JOBVEN_API_KEY: "jv-key-42" },
    });
    await c.callTool(SEARCH_JOBS, {});
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every((call) => call.headers["X-API-Key"] === "jv-key-42"),
    );
  });

  it("sends no X-API-Key header when JOBVEN_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SEARCH_JOBS, {});
    assert.ok(calls.every((call) => call.headers["X-API-Key"] === undefined));
  });

  it("never sends an Authorization header, with or without a key", async () => {
    const withKey = makeUpstream();
    const c1 = new JobhuntClient({
      fetchFn: withKey.fetchFn,
      env: { JOBVEN_API_KEY: "jv-key-42" },
    });
    await c1.callTool(SEARCH_JOBS, {});
    assert.ok(withKey.calls.every((call) => call.headers["Authorization"] === undefined));
    const { client: c2, calls } = stubClient();
    await c2.callTool(SEARCH_JOBS, {});
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards a search_jobs call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { q: "typescript" };
    await c.callTool(SEARCH_JOBS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH_JOBS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a fully-specified search_jobs verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      q: "\"staff engineer\" OR lead",
      descriptionQuery: "distributed systems",
      remoteType: ["remote", "hybrid"],
      experienceLevel: ["senior"],
      employmentType: ["full_time"],
      skills: ["typescript", "react"],
      industry: ["fintech"],
      language: "en",
      location: "Remote",
      country: "US",
      state: "CA",
      city: "San Francisco",
      minSalary: 150000,
      maxSalary: 220000,
      salaryCurrency: "USD",
      hasVisaSponsorship: true,
      hasRelocation: false,
      status: "active",
      postedAfter: 1700000000,
      postedBefore: 1800000000,
      listedAfter: 1700000000,
      sortBy: "postedAt",
      order: "DESC",
      includeTotal: true,
      cursor: "cur-1",
      limit: 25,
    };
    await c.callTool(SEARCH_JOBS, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH_JOBS);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a get_job call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      descriptionFormat: "markdown",
    };
    await c.callTool(GET_JOB, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, GET_JOB);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a search_companies call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      search: "acme",
      status: "active",
      isVerified: true,
      sortBy: "name",
      sortOrder: "ASC",
      page: 2,
      limit: 25,
    };
    await c.callTool(SEARCH_COMPANIES, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SEARCH_COMPANIES);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a get_company call verbatim", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(GET_COMPANY, { id: 42 });
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, GET_COMPANY);
    assert.deepEqual(params.arguments, { id: 42 });
  });

  it("forwards a webhook_example call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { event: "job.created", language: "python" };
    await c.callTool(WEBHOOK_EXAMPLE, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, WEBHOOK_EXAMPLE);
    assert.deepEqual(params.arguments, args);
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "quota exhausted" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool(GET_JOB, { id: "123e4567-e89b-12d3-a456-426614174000" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool(SEARCH_COMPANIES, {});
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      WEBHOOK_EXAMPLE,
      { event: "job.closed", language: "go" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, WEBHOOK_EXAMPLE);
    assert.deepEqual(params.arguments, { event: "job.closed", language: "go" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as jobhunt error text", () => {
  it("maps a JSON-RPC error to `jobhunt error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "search failed upstream" },
    });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: search failed upstream");
  });

  it("maps an initialize JSON-RPC error to jobhunt error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: malformed response");
  });

  it("maps a response with no result object to a malformed-response error", async () => {
    const { client: c } = stubClient({
      callBodyText: '{"jsonrpc":"2.0","id":3,"result":null}',
    });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: malformed response");
  });

  it("maps a non-2xx upstream status to jobhunt error text", async () => {
    const { client: c } = stubClient({ callBodyText: "internal error", callStatus: 500 });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: HTTP 500");
  });

  it("maps a throwing fetch to jobhunt error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^jobhunt error: /);
  });

  it("maps a throwing initialize fetch to jobhunt error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "jobhunt error: socket hang up");
  });

  it("maps a timed-out call to jobhunt error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(SEARCH_JOBS, {});
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^jobhunt error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("picks the matching id among several SSE messages", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });

  it("ignores the SSE [DONE] sentinel", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n';
    assert.deepEqual(parseRpcBody(body, 4), {
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
    assert.equal(parseRpcBody("[1,2,3]"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, SEARCH_JOBS, ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, GET_JOB, "id=abc"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid search_jobs call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, SEARCH_JOBS, { q: "react" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { q: "react" });
  });

  it("forwards a valid get_company call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, GET_COMPANY, { id: 9 });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, GET_COMPANY);
  });

  it("treats omitted arguments as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, SEARCH_COMPANIES, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([SEARCH_JOBS, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([SEARCH_JOBS, "[]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
  });
});
