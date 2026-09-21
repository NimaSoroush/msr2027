#!/usr/bin/env python3
"""Compute four cross-dataset feasibility counts for GitSkills and SpecMine."""

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import duckdb

GITSKILLS_URLS = [
    f"https://huggingface.co/datasets/mvaccargiu/gitskills/resolve/main/data/artifacts/part-{index:05d}.parquet"
    for index in range(31)
]


def normalize_repo(name: str) -> str:
    return name.strip().lower()


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def summarize(skill_rows, spec_rows, pr_repos):
    skill_repos = set()
    skill_first = {}
    clones = defaultdict(set)
    for repo, file_sha, first_commit_at in skill_rows:
        repo = normalize_repo(repo)
        skill_repos.add(repo)
        if file_sha:
            clones[file_sha].add(repo)
        timestamp = parse_time(first_commit_at)
        if timestamp is not None and (repo not in skill_first or timestamp < skill_first[repo]):
            skill_first[repo] = timestamp

    spec_repos = set()
    spec_first = {}
    for repo, first_commit_at in spec_rows:
        repo = normalize_repo(repo)
        spec_repos.add(repo)
        timestamp = parse_time(first_commit_at)
        if timestamp is not None and (repo not in spec_first or timestamp < spec_first[repo]):
            spec_first[repo] = timestamp

    overlap = skill_repos & spec_repos
    temporal_eligible = overlap & skill_first.keys() & spec_first.keys()
    skill_predates_spec = {
        repo for repo in temporal_eligible if skill_first[repo] < spec_first[repo]
    }
    pr_overlap = overlap & {normalize_repo(repo) for repo in pr_repos}
    repeated_clone_families = {
        file_sha: repos & overlap
        for file_sha, repos in clones.items()
        if len(repos & overlap) >= 2
    }

    return {
        "git_skills_repositories": len(skill_repos),
        "specmine_repositories": len(spec_repos),
        "repositories_in_both": len(overlap),
        "overlap_with_both_first_commit_dates": len(temporal_eligible),
        "overlap_where_observed_skill_predates_first_spec": len(skill_predates_spec),
        "overlap_represented_in_specmine_pr_layer": len(pr_overlap),
        "repeated_skill_clone_families_spanning_two_or_more_overlap_repositories": len(
            repeated_clone_families
        ),
        "overlap_repositories_in_repeated_skill_clone_families": len(
            set().union(*repeated_clone_families.values())
            if repeated_clone_families
            else set()
        ),
    }


def self_test():
    counts = summarize(
        [
            ("A/One", "x", "2026-01-01T00:00:00Z"),
            ("b/two", "x", "2026-03-01T00:00:00Z"),
            ("c/three", "y", None),
        ],
        [
            ("a/one", "2026-02-01T00:00:00Z"),
            ("B/Two", "2026-02-01T00:00:00Z"),
            ("d/four", "2026-01-01T00:00:00Z"),
        ],
        ["A/ONE", "d/four"],
    )
    assert counts["repositories_in_both"] == 2
    assert counts["overlap_where_observed_skill_predates_first_spec"] == 1
    assert counts["overlap_represented_in_specmine_pr_layer"] == 1
    assert counts[
        "repeated_skill_clone_families_spanning_two_or_more_overlap_repositories"
    ] == 1


def full_census_counts(spec_files: Path, pull_requests: Path):
    connection = duckdb.connect()
    connection.execute(
        """
        CREATE TEMP TABLE skills AS
        SELECT lower(trim(repo_full_name)) AS repo,
               file_sha,
               try_cast(first_commit_at AS TIMESTAMPTZ) AS first_commit_at
        FROM read_parquet(?)
        """,
        [GITSKILLS_URLS],
    )
    connection.execute(
        """
        CREATE TEMP TABLE skill_repos AS
        SELECT repo, min(first_commit_at) AS first_commit_at
        FROM skills GROUP BY repo
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE spec_repos AS
        SELECT lower(trim(repo_name)) AS repo,
               min(try_cast(file_first_commit_at AS TIMESTAMPTZ)) AS first_commit_at
        FROM read_parquet(?) GROUP BY repo
        """,
        [str(spec_files)],
    )
    connection.execute(
        """
        CREATE TEMP TABLE overlap AS
        SELECT s.repo, s.first_commit_at AS skill_first, p.first_commit_at AS spec_first
        FROM skill_repos s JOIN spec_repos p USING (repo)
        """
    )
    connection.execute(
        """
        CREATE TEMP TABLE repeated_clones AS
        SELECT file_sha
        FROM skills JOIN overlap USING (repo)
        WHERE file_sha IS NOT NULL
        GROUP BY file_sha
        HAVING count(DISTINCT repo) >= 2
        """
    )

    scalar = lambda query, params=[]: connection.execute(query, params).fetchone()[0]
    return {
        "git_skills_occurrences": scalar("SELECT count(*) FROM skills"),
        "git_skills_repositories": scalar("SELECT count(*) FROM skill_repos"),
        "specmine_repositories": scalar("SELECT count(*) FROM spec_repos"),
        "repositories_in_both": scalar("SELECT count(*) FROM overlap"),
        "overlap_with_both_first_commit_dates": scalar(
            "SELECT count(*) FROM overlap WHERE skill_first IS NOT NULL AND spec_first IS NOT NULL"
        ),
        "overlap_where_observed_skill_predates_first_spec": scalar(
            "SELECT count(*) FROM overlap WHERE skill_first < spec_first"
        ),
        "overlap_represented_in_specmine_pr_layer": scalar(
            """
            SELECT count(DISTINCT o.repo)
            FROM overlap o
            JOIN read_parquet(?) p ON o.repo = lower(trim(p.repo_name))
            """,
            [str(pull_requests)],
        ),
        "repeated_skill_clone_families_spanning_two_or_more_overlap_repositories": scalar(
            "SELECT count(*) FROM repeated_clones"
        ),
        "overlap_repositories_in_repeated_skill_clone_families": scalar(
            """
            SELECT count(DISTINCT s.repo)
            FROM skills s
            JOIN overlap o USING (repo)
            JOIN repeated_clones c USING (file_sha)
            """
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gitskills", type=Path, required=True, help=argparse.SUPPRESS)
    parser.add_argument("--spec-files", type=Path, required=True)
    parser.add_argument("--pull-requests", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    self_test()

    result = {
        "scope": "full GitSkills census joined to full SpecMine v1.0",
        **full_census_counts(args.spec_files, args.pull_requests),
        "definitions": {
            "repository_join": "case-insensitive GitHub owner/repository name",
            "predates": "earliest available GitSkills first_commit_at is earlier than earliest available SpecMine file_first_commit_at in same repository",
            "clone_family": "same non-null GitSkills file_sha in at least two overlapping repositories",
        },
    }
    rendered = json.dumps(result, indent=2, sort_keys=True)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n")


if __name__ == "__main__":
    main()
