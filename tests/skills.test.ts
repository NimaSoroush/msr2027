import { describe, expect, it } from "vitest";
import { invariantHashes, loadSkills, splitSkill, type Skill } from "../src/material/skills.ts";

const SRC = '---\nname: pdf-forms\ndescription: Fill PDF forms. Triggers on "fill pdf".\n---\n# Steps\n- open `acroform`\n';

describe("splitSkill", () => {
  it("separates frontmatter from body", () => {
    const s = splitSkill(SRC);
    expect(s.name).toBe("pdf-forms");
    expect(s.description).toBe('Fill PDF forms. Triggers on "fill pdf".');
    expect(s.body.startsWith("# Steps")).toBe(true);
  });

  it("handles frontmatter-only skills", () => {
    const s = splitSkill("---\nname: x\ndescription: y\n---\n");
    expect(s.body).toBe("");
    expect(s.description).toBe("y");
  });

  it("handles a body with no frontmatter", () => {
    const s = splitSkill("# Just a body\n");
    expect(s.frontmatter).toBe("");
    expect(s.description).toBe("");
    expect(s.body).toBe("# Just a body\n");
  });
});

const page = (columns: string[], rows: (string | null)[][]) => ({
  columns,
  rows,
  rowCount: rows.length,
  declaredRows: rows.length,
  hasNextPage: false,
  durationMs: 1,
});

const COLS = ["repo_full_name", "path", "name", "description", "content"];
const rowFor = (repo: string, i: number): string[] => [
  repo,
  `s${i}/SKILL.md`,
  `s${i}`,
  `d${i}`,
  `---\nname: s${i}\ndescription: d${i}\n---\nbody ${i}\n`,
];

describe("loadSkills", () => {
  it("loads every skill of a 293-skill repo, not 50", async () => {
    const rows = Array.from({ length: 293 }, (_, i) => rowFor("o/big", i));
    const runner = { queryAll: async () => page(COLS, rows) };
    expect((await loadSkills(runner, "o/big")).length).toBe(293);
  });

  it("rejects empty or literal-null descriptions", async () => {
    const runner = { queryAll: async () => page(COLS, [["o/a", "p", "n", "null", "b"]]) };
    await expect(loadSkills(runner, "o/a")).rejects.toThrow(/description/);
  });

  it("loads an undescribed skill only when told to, and never a transported null", async () => {
    const rows = [
      ["o/a", "p", "n", null, "# body"],
      ["o/a", "q", "m", null, "---\nname: m\ndescription: from frontmatter\n---\n"],
    ];
    const runner = { queryAll: async () => page(COLS, rows) };
    await expect(loadSkills(runner, "o/a")).rejects.toThrow(/no usable description/);

    const loaded = await loadSkills(runner, "o/a", { allowUndescribed: true });
    expect(loaded.map((s) => s.description)).toEqual(["", "from frontmatter"]);

    const corrupt = { queryAll: async () => page(COLS, [["o/a", "p", "n", "null", "# body"]]) };
    await expect(loadSkills(corrupt, "o/a", { allowUndescribed: true })).rejects.toThrow(/transport artifact/);
  });

  it("keeps the frontmatter as written and the body separately", async () => {
    const runner = { queryAll: async () => page(COLS, [rowFor("o/a", 0)]) };
    const [skill] = await loadSkills(runner, "o/a");
    expect(skill.frontmatter).toBe("name: s0\ndescription: d0");
    expect(skill.description).toBe("d0");
    expect(skill.body).toBe("body 0\n");
    expect(skill.skillId).toBe("o/a:s0/SKILL.md");
  });
});

describe("invariantHashes", () => {
  const skill = (path: string, description: string, body = "b"): Skill => ({
    skillId: `o/a:${path}`,
    repo: "o/a",
    path,
    name: path.split("/")[0],
    description,
    frontmatter: `name: ${path.split("/")[0]}\ndescription: ${description}`,
    body,
  });

  it("does not depend on order and ignores the body", () => {
    const a = invariantHashes([skill("x/SKILL.md", "one"), skill("y/SKILL.md", "two")]);
    const b = invariantHashes([skill("y/SKILL.md", "two", "rewritten"), skill("x/SKILL.md", "one")]);
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(["description", "frontmatter", "structure"]);
    for (const h of Object.values(a)) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a description changes", () => {
    const a = invariantHashes([skill("x/SKILL.md", "one")]);
    const b = invariantHashes([skill("x/SKILL.md", "two")]);
    expect(a.description).not.toBe(b.description);
    expect(a.structure).toBe(b.structure);
  });
});
