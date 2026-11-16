/**
 * The read surface of GitHub this study needs, and the two screens that run before anything is
 * materialised.
 *
 * Only two endpoints are used (`GET /repos/{repo}/pulls/{n}` and `GET /repos/{repo}/tarball/{sha}`),
 * so a read-only token is enough and the plan must never ask for more. The token is read from the
 * environment by the caller, sent as a header, and never written to disk, logged or echoed in an
 * error message.
 */
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The pinned discovery list from spec §7.2. Discovery is a fixed list rather than a heuristic:
 * a pattern would silently change the material when someone adds a file shape to a repo.
 */
export const MEMORY_CANDIDATES: readonly string[] = Object.freeze([
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "MEMORY.md",
  "docs/conventions.md",
]);

const CANDIDATE_BASENAMES = new Set(
  MEMORY_CANDIDATES.map((candidate) => candidate.split("/").pop()!.toLowerCase()),
);

/** Memory files present in a tree, matched on basename at any depth and returned as given. */
export function discoverMemoryFiles(paths: string[]): string[] {
  return paths.filter((path) => {
    const base = path.split("/").pop() ?? "";
    return CANDIDATE_BASENAMES.has(base.toLowerCase());
  });
}

export type PrMeta = {
  title: string;
  body: string;
  baseSha: string;
  baseBranch: string;
};

export type ScreenVerdict = { passes: boolean; reason?: "quotes-patch" | "no-behaviour" };

const FENCE = /```([\w-]*)\r?\n([\s\S]*?)```/g;

/**
 * Spec §8.5 step 2: a PR whose description contains the patch is not an independent statement of
 * the behaviour, so it cannot serve as the gold set for what a replay should discover.
 */
export function screenPrBody(p: { title: string; body: string }): ScreenVerdict {
  const body = p.body ?? "";

  for (const match of body.matchAll(FENCE)) {
    const info = match[1].toLowerCase();
    const content = match[2];
    if (info.startsWith("diff")) return { passes: false, reason: "quotes-patch" };
    if (/^diff --git /m.test(content)) return { passes: false, reason: "quotes-patch" };
    if (/^@@ /m.test(content)) return { passes: false, reason: "quotes-patch" };
    if (/^(---|\+\+\+) [^\n]*$/m.test(content)) return { passes: false, reason: "quotes-patch" };
  }
  if (/\bfiles? changed\b/i.test(body)) return { passes: false, reason: "quotes-patch" };

  const paths = new Set(
    [...body.matchAll(/(?:^|\s)([\w.-]+(?:\/[\w.-]+)+\.[A-Za-z0-9]+)\b/g)].map((m) => m[1]),
  );
  if (paths.size >= 3) return { passes: false, reason: "quotes-patch" };

  // Behaviour means a sentence about what happens or what should happen — not a title like "fix".
  const prose = body.replace(FENCE, " ");
  const sentences = `${p.title}. ${prose}`.split(/(?<=[.!?])\s+/);
  const cue =
    /\b(fail|fails|failed|failure|crash|crashes|crashed|error|errors|throw|throws|threw|return|returns|returned|should|expect|expects|expected|observed|actual|instead|when|broken|incorrect|wrong|missing|does not|doesn't|cannot|can't|never|always|want|wanted|need|needs|regression|bug)\b/i;
  const stated = sentences.some((sentence) => {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    return words.length >= 3 && cue.test(sentence);
  });
  return stated ? { passes: true } : { passes: false, reason: "no-behaviour" };
}

const API = "https://api.github.com";
const MAX_RETRIES = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Two endpoints, ETag caching, and honest rate-limit handling.
 *
 * The cache is keyed by URL and stores only public metadata, so it is safe to keep between runs.
 * A rate-limited response is waited out rather than retried into the ground; the wait is printed
 * to stderr because a silent multi-minute pause looks like a hang.
 */
export class GitHubClient {
  private token: string;
  private userAgent: string;
  private cacheDir: string;
  private resetAt = 0;

  constructor(p: { token: string; userAgent?: string; cacheDir?: string }) {
    if (!p.token || !p.token.trim()) throw new Error("GitHubClient requires a token");
    this.token = p.token;
    this.userAgent = p.userAgent ?? "msr2027-activation-study";
    this.cacheDir = p.cacheDir ?? "analysis/cache/github";
    mkdirSync(this.cacheDir, { recursive: true });
  }

  private async waitForWindow(): Promise<void> {
    const wait = this.resetAt - Date.now();
    if (wait > 0) await sleep(wait + 1_000);
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this.waitForWindow();
      const res = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": this.userAgent,
          ...(init.headers as Record<string, string> | undefined),
        },
        redirect: "follow",
      });

      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      if (remaining === "0" && reset) {
        this.resetAt = Number(reset) * 1_000;
        console.error(`rate limit exhausted; waiting until ${new Date(this.resetAt).toISOString()}`);
      }

      if (res.status !== 403 && res.status !== 429) return res;

      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        : 2 ** attempt * 1_000 + Math.floor(Math.random() * 500);
      console.error(`GitHub ${res.status} on ${url}; retrying in ${backoff}ms`);
      await sleep(backoff);
    }
    throw new Error(`GitHub rate-limited or refused ${url} after ${MAX_RETRIES} retries`);
  }

  private cachePath(url: string): string {
    return join(this.cacheDir, `${createHash("sha256").update(url).digest("hex")}.json`);
  }

  private async cachedJson<T>(url: string): Promise<T> {
    const path = this.cachePath(url);
    let etag: string | undefined;
    let cached: T | undefined;
    try {
      const stored = JSON.parse(readFileSync(path, "utf8")) as { etag: string; body: T };
      etag = stored.etag;
      cached = stored.body;
    } catch {
      // No cache entry: a normal first run.
    }

    const res = await this.fetch(url, {
      headers: etag ? { "if-none-match": etag } : undefined,
    });
    if (res.status === 304 && cached !== undefined) return cached;
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
    const body = (await res.json()) as T;
    const newEtag = res.headers.get("etag");
    if (newEtag) writeFileSync(path, `${JSON.stringify({ etag: newEtag, body })}\n`);
    return body;
  }

  /** Title, body and the merge-base coordinates of one pull request. */
  async pr(repo: string, n: number): Promise<PrMeta> {
    const data = await this.cachedJson<{
      title?: string;
      body?: string | null;
      base?: { sha?: string; ref?: string };
    }>(`${API}/repos/${repo}/pulls/${n}`);
    if (!data.base?.sha) throw new Error(`${repo}#${n}: response has no base.sha`);
    return {
      title: data.title ?? "",
      body: data.body ?? "",
      baseSha: data.base.sha,
      baseBranch: data.base.ref ?? "",
    };
  }

  /** The base tree as GitHub's tarball, streamed to `dest` so a large repo never sits in memory. */
  async treeTarball(repo: string, sha: string, dest: string): Promise<void> {
    const url = `${API}/repos/${repo}/tarball/${sha}`;
    const res = await this.fetch(url);
    if (!res.ok || !res.body) throw new Error(`GitHub ${res.status} for ${url}`);
    const part = `${dest}.part`;
    mkdirSync(join(dest, ".."), { recursive: true });
    try {
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
      renameSync(part, dest);
    } catch (error) {
      rmSync(part, { force: true });
      throw error;
    }
  }
}
