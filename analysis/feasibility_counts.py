#!/usr/bin/env python3
"""Compute four cross-dataset feasibility counts for GitSkills and SpecMine."""

import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import duckdb


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gitskills", type=Path, required=True)
    parser.add_argument("--spec-files", type=Path, required=True)
    parser.add_argument("--pull-requests", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    self_test()

    with sqlite3.connect(f"file:{args.gitskills}?mode=ro", uri=True) as connection:
        skill_rows = connection.execute(
            "SELECT repo_full_name, file_sha, first_commit_at FROM artifacts"
        ).fetchall()

    connection = duckdb.connect()
    spec_rows = connection.execute(
        "SELECT repo_name, file_first_commit_at FROM read_parquet(?)",
        [str(args.spec_files)],
    ).fetchall()
    pr_repos = [
        row[0]
        for row in connection.execute(
            "SELECT DISTINCT repo_name FROM read_parquet(?)", [str(args.pull_requests)]
        ).fetchall()
    ]

    result = {
        "scope": "GitSkills curated sample joined to full SpecMine v1.0",
        **summarize(skill_rows, spec_rows, pr_repos),
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
