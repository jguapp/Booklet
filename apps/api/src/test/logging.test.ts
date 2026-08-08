import { afterEach, describe, expect, it } from "vitest";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp, redactedRequestSerializer } from "../app.js";

/**
 * Two separate things the log stream has to get right (S2, S6).
 *
 * The redaction half is asserted against the serializer directly rather than
 * by capturing pino output, because the serializer is the only place where
 * the secret can still be removed: once pino has the line, the credential is
 * already in whatever ships the logs off the box.
 */

const FEED_TOKEN = "bkpod_e6f0a1c2d3e4f5061728394a5b6c7d8e";
const SHARE_SLUG = "9f2c1b7ae4d34c";

describe("request log redaction", () => {
  function serialize(url: string) {
    return redactedRequestSerializer({
      method: "GET",
      url,
      host: "booklet.example",
      ip: "203.0.113.7",
      socket: { remotePort: 51234 },
    });
  }

  it("redacts the feed token out of a podcast feed URL", () => {
    const line = serialize(`/podcast/${FEED_TOKEN}/feed.xml?filter=queue`);
    expect(line.url).toBe("/podcast/[redacted]/feed.xml?filter=queue");
    expect(JSON.stringify(line)).not.toContain(FEED_TOKEN);
  });

  it("redacts the feed token out of an episode audio URL, keeping the article id", () => {
    // The article id is not a credential and is the part that makes a log
    // line useful ("which episode 500'd"), so redacting the whole path would
    // trade one unusable log for another.
    const line = serialize(`/podcast/${FEED_TOKEN}/episodes/art_1234/audio.wav`);
    expect(line.url).toBe("/podcast/[redacted]/episodes/art_1234/audio.wav");
    expect(JSON.stringify(line)).not.toContain(FEED_TOKEN);
  });

  it("redacts a public share slug, which is the entire access control for the page", () => {
    const line = serialize(`/api/public/shares/${SHARE_SLUG}`);
    expect(line.url).toBe("/api/public/shares/[redacted]");
    expect(JSON.stringify(line)).not.toContain(SHARE_SLUG);
  });

  it("leaves every other path alone, including the authenticated feed-management route", () => {
    expect(serialize("/api/articles?limit=20&cursor=abc").url).toBe("/api/articles?limit=20&cursor=abc");
    // /api/podcast/feed is requireAuth'd and carries no secret in its path --
    // redacting it would lose the route name for no gain.
    expect(serialize("/api/podcast/feed").url).toBe("/api/podcast/feed");
    expect(serialize("/api/shares/abc123").url).toBe("/api/shares/abc123");
    expect(serialize("/api/health").url).toBe("/api/health");
  });

  it("keeps the fields an access log is read for", () => {
    const line = serialize(`/podcast/${FEED_TOKEN}/feed.xml`);
    expect(line.method).toBe("GET");
    expect(line.host).toBe("booklet.example");
    expect(line.remoteAddress).toBe("203.0.113.7");
    expect(line.remotePort).toBe(51234);
  });
});

/** Captures what would have been logged, in call order. */
interface Entry {
  level: string;
  obj: Record<string, unknown>;
  msg: string;
}

function recordingLogger(entries: Entry[]): FastifyBaseLogger {
  const record =
    (level: string) =>
    (objOrMsg: unknown, maybeMsg?: unknown): void => {
      if (typeof objOrMsg === "string") entries.push({ level, obj: {}, msg: objOrMsg });
      else entries.push({ level, obj: (objOrMsg ?? {}) as Record<string, unknown>, msg: String(maybeMsg ?? "") });
    };
  const logger = {
    level: "info",
    silent: () => {},
    fatal: record("fatal"),
    error: record("error"),
    warn: record("warn"),
    info: record("info"),
    debug: record("debug"),
    trace: record("trace"),
    child: () => logger,
  };
  return logger as unknown as FastifyBaseLogger;
}

describe("TRUST_PROXY observability", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete process.env.TRUST_PROXY;
  });

  it("reports the resolved value at startup, because nothing else ever mentions it", async () => {
    const entries: Entry[] = [];
    app = await buildApp({ loggerInstance: recordingLogger(entries) });
    await app.ready();

    const startup = entries.find((e) => e.msg.includes("trust proxy"));
    expect(startup, `no startup line about trust proxy in ${JSON.stringify(entries)}`).toBeDefined();
    expect(startup!.obj.trustProxy).toBe(false);
  });

  it("reports trustProxy: true when TRUST_PROXY is set", async () => {
    process.env.TRUST_PROXY = "true";
    const entries: Entry[] = [];
    app = await buildApp({ loggerInstance: recordingLogger(entries) });
    await app.ready();

    const startup = entries.find((e) => e.msg.includes("trust proxy"));
    expect(startup?.obj.trustProxy).toBe(true);
  });

  it("reports, once, whether the first real request arrived with X-Forwarded-For", async () => {
    const entries: Entry[] = [];
    app = await buildApp({ loggerInstance: recordingLogger(entries) });
    await app.ready();

    await app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-for": "198.51.100.9" } });

    const first = entries.filter((e) => e.msg.includes("first request"));
    expect(first, `no first-request proxy line in ${JSON.stringify(entries)}`).toHaveLength(1);
    expect(first[0].obj.xForwardedFor).toBe(true);
    // trustProxy is off here, so the resolved ip must NOT be the forwarded
    // one -- that mismatch is the whole misconfiguration this line exists to
    // make visible.
    expect(first[0].obj.ip).not.toBe("198.51.100.9");
    expect(typeof first[0].obj.ip).toBe("string");

    await app.inject({ method: "GET", url: "/api/health" });
    expect(entries.filter((e) => e.msg.includes("first request"))).toHaveLength(1);
  });

  it("says so when no X-Forwarded-For arrived, which is the wrong-on failure", async () => {
    const entries: Entry[] = [];
    app = await buildApp({ loggerInstance: recordingLogger(entries) });
    await app.ready();

    await app.inject({ method: "GET", url: "/api/health" });

    const first = entries.find((e) => e.msg.includes("first request"));
    expect(first?.obj.xForwardedFor).toBe(false);
  });
});
