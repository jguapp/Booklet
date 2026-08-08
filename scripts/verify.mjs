#!/usr/bin/env node
/**
 * One command that runs everything checkable on this machine, and then says
 * plainly what it did *not* check.
 *
 * This exists because "the tests pass" was quietly ambiguous. `pnpm test`
 * (turbo) runs the shared/api/web unit suites and nothing else -- not lint,
 * not typecheck, not the production bundle, not the browser suite. Four of
 * the seven things CI checks were invisible to it, including the esbuild
 * bundle, which has broken while every other signal stayed green (a direct
 * @huggingface/transformers import pulled a native binding into the bundle;
 * tsc resolves through node_modules and never asks who *declared* a package,
 * so it was perfectly happy).
 *
 * The reporting matters as much as the running. A verification tool that
 * silently skips what it cannot do is worse than one that runs less: it
 * teaches you to read a green summary as "safe to deploy". So anything
 * skipped is named, with the reason, and the closing section lists what this
 * cannot cover anywhere -- the Docker production path above all.
 *
 *   pnpm verify          # everything that needs no running services
 *   pnpm verify --e2e    # also the browser suite (needs dev servers up)
 */
import { spawnSync } from "node:child_process";
import net from "node:net";
import process from "node:process";

const withE2e = process.argv.includes("--e2e");

const BOLD = "[1m";
const DIM = "[2m";
const GREEN = "[32m";
const RED = "[31m";
const YELLOW = "[33m";
const OFF = "[0m";

/** @type {{name: string, status: "pass"|"fail"|"skip", note?: string, ms: number}[]} */
const results = [];

function reachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function run(name, command, args, env = {}) {
  process.stdout.write(`${DIM}running${OFF} ${name} … `);
  const started = Date.now();
  const res = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  const ms = Date.now() - started;
  const ok = res.status === 0;
  results.push({ name, status: ok ? "pass" : "fail", ms });
  process.stdout.write(ok ? `${GREEN}ok${OFF} ${DIM}${ms}ms${OFF}\n` : `${RED}FAILED${OFF}\n`);
  if (!ok) {
    // Only the failing command's output, so a failure is readable without
    // scrolling past six successful ones.
    process.stdout.write(`\n${(res.stdout ?? "") + (res.stderr ?? "")}\n`);
  }
  return ok;
}

function skip(name, note) {
  results.push({ name, status: "skip", note, ms: 0 });
  process.stdout.write(`${DIM}skipped${OFF} ${name} ${YELLOW}(${note})${OFF}\n`);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

console.log(`\n${BOLD}Booklet verify${OFF}\n`);

// @booklet/shared is unbuilt workspace TypeScript that other packages'
// typechecks resolve against, so it has to go first.
run("build @booklet/shared", pnpm, ["--filter", "@booklet/shared", "build"]);

run("typecheck api", pnpm, ["--filter", "@booklet/api", "exec", "tsc", "--noEmit"]);
run("typecheck web", pnpm, ["--filter", "@booklet/web", "exec", "tsc", "--noEmit"]);
run("typecheck extension", pnpm, ["--filter", "@booklet/extension", "exec", "tsc", "--noEmit"]);
run("typecheck mobile", pnpm, ["--filter", "@booklet/mobile", "exec", "tsc", "--noEmit"]);
run("lint web", pnpm, ["--filter", "@booklet/web", "lint"]);

// The production bundle. Cheap, and the only local signal for a whole class
// of failure that typecheck cannot see.
run("bundle api (production esbuild)", pnpm, ["--filter", "@booklet/api", "exec", "node", "scripts/build.mjs"]);

run("unit @booklet/shared", pnpm, ["--filter", "@booklet/shared", "test"]);
run("unit @booklet/web", pnpm, ["--filter", "@booklet/web", "test"]);

// apps/api's suite talks to a real database; without one it fails in a way
// that looks like broken code rather than a missing service.
const dbUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres?schema=public";
const parsedDb = (() => {
  try {
    const u = new URL(dbUrl);
    return { host: u.hostname, port: Number(u.port || 5432) };
  } catch {
    return null;
  }
})();

if (parsedDb && (await reachable(parsedDb.host, parsedDb.port))) {
  run("unit @booklet/api", pnpm, ["--filter", "@booklet/api", "test"], {
    DATABASE_URL: dbUrl,
    NODE_ENV: "test",
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "verify-secret-not-for-production",
  });
} else {
  skip("unit @booklet/api", `no database at ${parsedDb ? `${parsedDb.host}:${parsedDb.port}` : dbUrl} — start one with 'pnpm dev:db'`);
}

let needsE2eSetupNote = false;

if (withE2e) {
  const webUp = await reachable("127.0.0.1", 3000);
  const apiUp = await reachable("127.0.0.1", 4000);
  if (webUp && apiUp) {
    // @live specs need the public internet by definition (see e2e/helpers.ts);
    // excluding them is what makes this runnable anywhere.
    run("e2e web (offline subset)", pnpm, [
      "--filter",
      "@booklet/web",
      "test:e2e",
      "--grep-invert",
      "@live",
    ]);
  } else {
    const missing = [!apiUp && "api :4000", !webUp && "web :3000"].filter(Boolean).join(" and ");
    skip("e2e web", `${missing} not running — see the e2e setup note below`);
    needsE2eSetupNote = true;
  }
} else {
  skip("e2e web", "not requested — pass --e2e (needs dev servers, see note below)");
  needsE2eSetupNote = true;
}

const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skip");
const passed = results.filter((r) => r.status === "pass");

console.log(`\n${BOLD}Summary${OFF}`);
console.log(`  ${GREEN}${passed.length} passed${OFF}${failed.length ? `, ${RED}${failed.length} failed${OFF}` : ""}${skipped.length ? `, ${YELLOW}${skipped.length} skipped${OFF}` : ""}`);
for (const r of failed) console.log(`  ${RED}fail${OFF} ${r.name}`);
for (const r of skipped) console.log(`  ${YELLOW}skip${OFF} ${r.name} — ${r.note}`);

// "Start the dev servers" is not enough, and finding that out costs a full
// 8-minute run: without these the API refuses to fetch the fixture server on
// 127.0.0.1 (its SSRF guard, correctly) and every article-saving spec fails
// on a modal that never closes, while the auth limits run out partway through
// and take down whichever specs happen to be next. Both failures look like
// broken code rather than missing setup.
if (needsE2eSetupNote) {
  console.log(`\n${BOLD}Running the e2e suite${OFF}`);
  console.log(`  ${DIM}pnpm dev:db                       # or point DATABASE_URL at any Postgres`);
  console.log(`  DATABASE_URL=... \\`);
  console.log(`  EXTRACTION_ALLOW_PRIVATE_ADDRESSES=true \\   # ignored under NODE_ENV=production`);
  console.log(`  AUTH_ATTEMPT_RATE_LIMIT_MAX=100000 \\        # the suite signs up dozens of times`);
  console.log(`  AUTH_REFRESH_RATE_LIMIT_MAX=100000 \\`);
  console.log(`  GLOBAL_RATE_LIMIT_MAX=100000 \\`);
  console.log(`    pnpm dev:api &`);
  console.log(`  pnpm dev:web &`);
  console.log(`  pnpm verify --e2e`);
  console.log(`  ${DIM}(set PLAYWRIGHT_CHROMIUM_EXECUTABLE if a browser is already installed`);
  console.log(`   at a build number Playwright doesn't recognise.)${OFF}`);
}

// The part that keeps a green run honest.
console.log(`\n${BOLD}Not covered by this command, anywhere${OFF}`);
console.log(`  ${DIM}• docker-build — builds both production images and boots the API against a`);
console.log(`    real Postgres. Needs a Docker daemon. This is the one that has caught real`);
console.log(`    bugs the rest of this cannot see; run it before any deploy:`);
console.log(`      docker build -f apps/api/Dockerfile -t booklet-api .${OFF}`);
console.log(`  ${DIM}• @live e2e specs — real extraction, dictionary lookup, and Kokoro TTS audio.`);
console.log(`    Need the public internet: pnpm --filter @booklet/web test:e2e --grep @live${OFF}`);
console.log(`  ${DIM}• bench-tts-ttfa — a measurement, not a gate. Needs Hugging Face reachable.${OFF}`);
console.log("");

process.exit(failed.length > 0 ? 1 : 0);
