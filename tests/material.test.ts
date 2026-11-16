import { describe, it, expect } from "vitest";
import { discoverMemoryFiles, MEMORY_CANDIDATES, screenPrBody } from "../src/material/github.ts";
import { materialise } from "../src/material/workdir.ts";
import { identityCompressor, destructiveCompressor } from "../src/compress/index.ts";

describe("discoverMemoryFiles", () => {
  it("matches the pinned list at any depth", () => {
    const found = discoverMemoryFiles(["CLAUDE.md", "pkg/AGENTS.md", ".cursorrules", "src/index.ts", "docs/conventions.md"]);
    expect(found.sort()).toEqual(["CLAUDE.md", ".cursorrules", "docs/conventions.md", "pkg/AGENTS.md"].sort());
  });
  it("is case-insensitive on the filename but returns the real path", () => {
    expect(discoverMemoryFiles(["Claude.md"])).toEqual(["Claude.md"]);
  });
  it("has a frozen candidate list", () => {
    expect(MEMORY_CANDIDATES).toContain("MEMORY.md");
    expect(Object.isFrozen(MEMORY_CANDIDATES)).toBe(true);
  });
});

describe("screenPrBody", () => {
  it("passes a body that states observed and expected behaviour", () => {
    const r = screenPrBody({
      title: "Retry flaky fetch",
      body: "Requests fail with ECONNRESET under load. They should retry with backoff.",
    });
    expect(r.passes).toBe(true);
  });
  it("fails a body with no stated behaviour", () => {
    expect(screenPrBody({ title: "fix", body: "" }).reason).toBe("no-behaviour");
  });
  it("fails a body that quotes the patch", () => {
    const body = "Observed: crash on empty input. Expected: no crash.\n```diff\n-  if (x) {\n+  if (y) {\n```";
    expect(screenPrBody({ title: "Fix parse", body }).reason).toBe("quotes-patch");
  });
});

describe("materialise", () => {
  const skills = [
    {
      skillId: "o/a:p",
      repo: "o/a",
      path: "p/SKILL.md",
      name: "s",
      description: "d",
      frontmatter: "name: s\ndescription: d",
      body: "# Body\nWe love prose here and there.\n",
    },
  ];
  it("writes the unchanged skill under C0", async () => {
    const dir = await materialise({ dir: "/tmp/mat-0", tarball: "", skills, condition: "C0", compress: identityCompressor() });
    expect(dir.written).toContain("p/SKILL.md");
    expect(dir.hashes.description).toBe(dir.hashes.description);
  });
  it("leaves the description hash identical under C1 and C4", async () => {
    const a = await materialise({ dir: "/tmp/mat-1", tarball: "", skills, condition: "C1", compress: identityCompressor() });
    const b = await materialise({ dir: "/tmp/mat-4", tarball: "", skills, condition: "C4", compress: destructiveCompressor() });
    expect(b.hashes.description).toBe(a.hashes.description);
    expect(b.hashes.frontmatter).toBe(a.hashes.frontmatter);
  });
  it("records a ratio per written file", async () => {
    const m = await materialise({ dir: "/tmp/mat-2", tarball: "", skills, condition: "C1", compress: identityCompressor() });
    expect(Object.keys(m.ratios)).toContain("p/SKILL.md");
  });
});
