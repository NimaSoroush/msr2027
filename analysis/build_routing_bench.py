"""Build the routing benchmark for the MSR 2027 compression study.

One JSON object per repository: a real candidate set of skills (name, description,
body) drawn from GitSkills, plus one or more query slots whose gold skill is known.
The task statement is filled in a later step (LLM paraphrase + human validation);
this script only freezes the sampling frame so every treatment sees identical inputs.

Usage
    python3 analysis/build_routing_bench.py --repos 200 --out analysis/bench_v1.jsonl
    python3 analysis/build_routing_bench.py --repos 3 --dry-run      # inspect only

Sampling notes
    Rows in the release are ordered by ingestion, so `ORDER BY rowid LIMIT n`
    gives a region-biased sample. Repos are taken with a stride over the whole
    repo table, which spreads the sample across the collection window.
"""
import argparse, json, random, sqlite3, sys

META = "analysis/meta.db"
FULL = "agent_skills_release.db"
MAX_BODY = 24000


def repo_frame(min_skills, max_skills, stride):
    """Repositories whose candidate set is large enough for routing to be non-trivial."""
    con = sqlite3.connect(META)
    rows = con.execute(
        """SELECT repo_full_name, COUNT(*) n
           FROM art WHERE content_fetched=1 AND desc_chars >= 80
           GROUP BY 1 HAVING n BETWEEN ? AND ?""",
        (min_skills, max_skills)).fetchall()
    rows.sort()
    return rows[::stride]


def load_candidates(repo, con):
    cur = con.execute(
        """SELECT path, name, description, content, body_chars, location_class,
                  commit_count, has_scripts, sibling_count
           FROM artifacts
           WHERE repo_full_name=? AND content_fetched=1
             AND description IS NOT NULL AND length(description) >= 80
           ORDER BY path""", (repo,))
    out = []
    for path, name, desc, content, body_chars, loc, cc, scripts, sib in cur:
        body = (content or "")[:MAX_BODY]
        out.append({
            "skill_id": path,
            "name": (name or path.split("/")[-2] if "/" in path else path)[:120],
            "description": desc.strip(),
            "body": body,
            "body_chars": body_chars,
            "location_class": loc,
            "commit_count": cc,
            "has_scripts": int(bool(scripts)),
            "sibling_count": sib or 0,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repos", type=int, default=200)
    ap.add_argument("--min-skills", type=int, default=8)
    ap.add_argument("--max-skills", type=int, default=40)
    ap.add_argument("--stride", type=int, default=7)
    ap.add_argument("--out", default="analysis/bench_v1.jsonl")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    frame = repo_frame(a.min_skills, a.max_skills, a.stride)
    print(f"eligible repositories: {len(frame):,} (stride {a.stride})", file=sys.stderr)

    full = sqlite3.connect(f"file:{FULL}?mode=ro", uri=True)
    full.text_factory = str
    rng = random.Random(20261223)

    kept, n_repos = [], 0
    for repo, n in frame:
        if n_repos >= a.repos:
            break
        cands = load_candidates(repo, full)
        if len(cands) < a.min_skills:
            continue
        gold = rng.choice(cands)
        # a query is only usable if the router string is discriminative within the set
        other_words = " ".join(c["name"] + " " + c["description"]
                               for c in cands if c["skill_id"] != gold["skill_id"]).lower()
        if gold["name"].lower() in other_words:
            continue
        kept.append({
            "repo": repo,
            "n_candidates": len(cands),
            "candidates": cands,
            "queries": [{
                "qid": f"{repo}#{gold['skill_id']}",
                "gold_skill_id": gold["skill_id"],
                "gold_name": gold["name"],
                "task_text": "",           # filled by the paraphrase step
                "task_source": "gold_description",
                "validated": False,
            }],
        })
        n_repos += 1

    if a.dry_run:
        print(json.dumps(kept[:1], indent=2)[:3000])
        print(f"\n[dry-run] repos kept: {len(kept)}", file=sys.stderr)
        return

    with open(a.out, "w") as f:
        for rec in kept:
            f.write(json.dumps(rec) + "\n")
    sizes = [r["n_candidates"] for r in kept]
    print(f"wrote {len(kept):,} repos to {a.out}; "
          f"candidate sets median={sorted(sizes)[len(sizes)//2] if sizes else 0} "
          f"max={max(sizes) if sizes else 0}; "
          f"queries={sum(len(r['queries']) for r in kept):,}", file=sys.stderr)


if __name__ == "__main__":
    main()
