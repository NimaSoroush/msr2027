import type { PrRow } from "./specmine.ts";

export type PoolRepo = {
  repo: string;
  /** All merged PRs in the repo, which is what the feasibility count reports. */
  nPrs: number;
  /** The subset whose diff touches code — the only ones a replay can ask an agent to perform. */
  nCodePrs: number;
  nSkills: number;
  nTextSkills: number;
};

export type SkillCount = { nSkills: number; nTextSkills: number };

/**
 * The pool is the spec's "several skills compete" population: repos that are in the merged PR
 * data and hold at least two text-bearing skills, so that activation is a real choice.
 *
 * Two counts are kept because they answer different questions: `nPrs` reproduces the feasibility
 * figure (223 repos holding 3,566 merged PRs), while `nCodePrs` is the replay-eligible subset.
 * Fifteen pool repos have no code-touching PR at all; they belong to the population but cannot
 * contribute a sample, and the sample task filters on `nCodePrs > 0` rather than pretending they
 * were never there.
 */
export function buildPool(p: {
  prs: PrRow[];
  skillCounts: Map<string, SkillCount>;
}): { repos: PoolRepo[]; excluded: Record<string, number> } {
  const excluded: Record<string, number> = { le_two_skills: 0 };
  const byRepo = new Map<string, PrRow[]>();

  for (const pr of p.prs) {
    const bucket = byRepo.get(pr.repo);
    if (bucket) bucket.push(pr);
    else byRepo.set(pr.repo, [pr]);
  }

  const repos: PoolRepo[] = [];
  for (const [repo, prs] of byRepo) {
    const counts = p.skillCounts.get(repo) ?? { nSkills: 0, nTextSkills: 0 };
    if (counts.nTextSkills < 2) {
      excluded.le_two_skills++;
      continue;
    }
    repos.push({
      repo,
      nPrs: prs.length,
      nCodePrs: prs.filter((pr) => pr.touchesCode).length,
      nSkills: counts.nSkills,
      nTextSkills: counts.nTextSkills,
    });
  }

  repos.sort((a, b) => a.repo.localeCompare(b.repo));
  return { repos, excluded };
}
