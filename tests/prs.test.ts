import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { readAllPrFiles, streamPullRequests } from "../src/prs/specmine.ts";
import { buildPool } from "../src/prs/corpus.ts";

const PR_HEADER =
  "tool,id,repo_name,pr_number,title,state,is_merged,merged_at,created_at,closed_at,author_login,head_branch,base_branch,n_files,n_specdir_files,n_spec_files,n_code_files,n_md_files,n_other_files,additions,deletions,files_status,touches_code,n_code_outside,n_prs_in_repo";

const write = (name: string, csv: string) => {
  const dir = mkdtempSync("/tmp/specmine-");
  const p = join(dir, name);
  writeFileSync(p, gzipSync(csv));
  return p;
};

describe("specmine", () => {
  it("parses the real header and keeps merged rows only", async () => {
    const csv = `${PR_HEADER}\r\nkiro,1,o/a,7,Fix the parser,closed,1,2026-02-01T00:00:00Z,,,,,main,3,0,0,2,1,0,10,4,,1,0,3\r\nkiro,2,o/a,8,Open one,open,0,,,,,,main,1,0,0,1,0,0,1,0,,0,0,3\r\n`;
    const rows = [];
    for await (const r of streamPullRequests(write("pull_requests.csv.gz", csv))) rows.push(r);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      tool: "kiro",
      repo: "o/a",
      prNumber: 7,
      touchesCode: true,
      nCodeFiles: 2,
    });
  });

  it("survives a quoted title containing a comma", async () => {
    const csv = `${PR_HEADER}\r\nkiro,1,o/a,7,"Add a,b support",closed,1,2026-02-01T00:00:00Z,,,,,main,1,0,0,1,0,0,1,0,,1,0,1\r\n`;
    const rows = [];
    for await (const r of streamPullRequests(write("pull_requests.csv.gz", csv))) rows.push(r);
    expect(rows[0].title).toBe("Add a,b support");
  });

  it("reads pr_files keyed by repo#pr", async () => {
    const csv =
      "tool,id,repo_name,pr_number,file_path,change_status,additions,deletions,is_specdir,is_spec,is_code,ext\r\nkiro,1,o/a,7,src/x.ts,modified,3,1,0,0,1,ts\r\n";
    const m = await readAllPrFiles(write("pr_files.csv.gz", csv), () => true);
    expect(m.get("o/a#7")![0].filePath).toBe("src/x.ts");
  });

  it("looks columns up by name, so a reordered header cannot shift values", async () => {
    const reordered =
      "repo_name,pr_number,title,is_merged,touches_code,n_code_files,tool,id,state,merged_at,created_at,closed_at,author_login,head_branch,base_branch,n_files,n_specdir_files,n_spec_files,n_md_files,n_other_files,additions,deletions,files_status,n_code_outside,n_prs_in_repo";
    const csv = `${reordered}\r\no/a,7,"Swapped, header",1,1,2,kiro,1,closed,2026-02-01T00:00:00Z,,,,main,3,0,0,1,0,10,4,,0,3\r\n`;
    const rows = [];
    for await (const r of streamPullRequests(write("pull_requests.csv.gz", csv))) rows.push(r);
    expect(rows[0]).toMatchObject({ title: "Swapped, header", repo: "o/a", prNumber: 7 });
  });

  it("refuses a file that lacks a required column", async () => {
    const csv = `tool,id,repo_name,pr_number,title\r\nkiro,1,o/a,7,t\r\n`;
    const rows = async () => {
      for await (const _ of streamPullRequests(write("pull_requests.csv.gz", csv))) void _;
    };
    await expect(rows()).rejects.toThrow(/is_merged/);
  });
});

describe("buildPool", () => {
  const prs = [
    {
      tool: "k",
      repo: "o/a",
      prNumber: 1,
      title: "t",
      mergedAt: "",
      baseBranch: "main",
      nFiles: 1,
      nCodeFiles: 1,
      touchesCode: true,
      additions: 1,
      deletions: 0,
    },
    {
      tool: "k",
      repo: "o/b",
      prNumber: 2,
      title: "t",
      mergedAt: "",
      baseBranch: "main",
      nFiles: 1,
      nCodeFiles: 1,
      touchesCode: true,
      additions: 1,
      deletions: 0,
    },
    {
      tool: "k",
      repo: "o/c",
      prNumber: 3,
      title: "t",
      mergedAt: "",
      baseBranch: "main",
      nFiles: 1,
      nCodeFiles: 1,
      touchesCode: true,
      additions: 1,
      deletions: 0,
    },
  ];
  const counts = new Map([
    ["o/a", { nSkills: 4, nTextSkills: 4 }],
    ["o/b", { nSkills: 1, nTextSkills: 1 }],
    ["o/c", { nSkills: 0, nTextSkills: 0 }],
  ]);

  it("keeps only repos with at least two text-bearing skills", () => {
    const { repos, excluded } = buildPool({ prs, skillCounts: counts });
    expect(repos.map((r) => r.repo)).toEqual(["o/a"]);
    expect(excluded.le_two_skills).toBe(2);
  });

  it("counts PRs per surviving repo", () => {
    expect(buildPool({ prs, skillCounts: counts }).repos[0].nPrs).toBe(1);
  });

  it("separates all merged PRs from the code-touching subset", () => {
    const mixed = [
      ...prs.slice(0, 1),
      { ...prs[0], prNumber: 4, touchesCode: false },
    ];
    const [repo] = buildPool({ prs: mixed, skillCounts: counts }).repos;
    expect(repo.nPrs).toBe(2);
    expect(repo.nCodePrs).toBe(1);
  });
});
