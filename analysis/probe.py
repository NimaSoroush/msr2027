import sqlite3, statistics, json, collections
con = sqlite3.connect("agent_skills_release.db")
con.text_factory = str
cur = con.cursor()

def pct(vals, ps=(1,5,10,25,50,75,90,95,99,99.9)):
    vals = sorted(vals); n=len(vals); out={}
    for p in ps:
        i = min(n-1, max(0, int(round(p/100*(n-1)))))
        out[str(p)] = vals[i]
    return out

rows = cur.execute("""
  SELECT body_chars, length(description), length(name), sibling_count, sibling_bytes,
         commit_count, has_scripts, has_references, frontmatter_valid, dedup_primary, repo_full_name
  FROM artifacts WHERE content_fetched=1
""").fetchall()
print("rows with content:", len(rows))
bc = [r[0] for r in rows if r[0] is not None]
print("body_chars percentiles:", pct(bc))
print("body_chars mean:", round(statistics.mean(bc),1), "median:", statistics.median(bc))
print("skills >4000 chars (incl. Anthropic 5k-word guidance):", sum(1 for x in bc if x>4000), round(100*sum(1 for x in bc if x>4000)/len(bc),1),"%")
print("skills >16000 chars:", sum(1 for x in bc if x>16000), round(100*sum(1 for x in bc if x>16000)/len(bc),1),"%")
print("skills >100k chars:", sum(1 for x in bc if x>100000))
d = [r[1] for r in rows if r[1] is not None]
print("description chars percentiles:", pct(d))
print("description mean:", round(statistics.mean(d),1))

# candidate set size per repo = skills visible to a selector in one repo
per_repo = collections.Counter(r[10] for r in rows)
sizes = sorted(per_repo.values())
print("repos with content:", len(per_repo), "skills/repo percentiles:", pct(sizes))
print("repos with >=10 skills:", sum(1 for s in sizes if s>=10), ">=50:", sum(1 for s in sizes if s>=50), ">=100:", sum(1 for s in sizes if s>=100))
print("max skills in one repo:", max(sizes))

# frontmatter / structure availability
print("frontmatter_valid:", sum(1 for r in rows if r[8]==1), "of", len(rows))
print("has_scripts:", sum(1 for r in rows if r[6]==1), "has_references:", sum(1 for r in rows if r[7]==1))
print("sibling_count>0:", sum(1 for r in rows if (r[3] or 0)>0))
cc=[r[5] for r in rows if r[5] is not None]
print("commit_count>0:", len(cc), "median commits:", statistics.median(cc) if cc else None, "p90:", pct(cc)["90"] if cc else None)
