import sqlite3, collections, statistics, re, sys
con = sqlite3.connect("agent_skills_release.db")
cur = con.cursor()
def log(*a): print(*a, flush=True)

log("== A. copy concentration ==")
rows = cur.execute("""SELECT file_sha, COUNT(*) n, AVG(body_chars), AVG(length(description))
 FROM artifacts WHERE content_fetched=1 GROUP BY file_sha""").fetchall()
log("distinct contents:", len(rows))
copies = sorted((r[1] for r in rows), reverse=True)
log("contents in >1 file:", sum(1 for c in copies if c>1), f"({100*sum(1 for c in copies if c>1)/len(copies):.1f}%)")
log("share of occurrences in top 1% contents: %.1f%%" % (100*sum(copies[:max(1,len(copies)//100)])/sum(copies)))
log("top copy counts:", copies[:8])
single=[r for r in rows if r[1]==1]; multi=[r for r in rows if r[1]>1]
log("median body_chars single-copy: %.0f | multi-copy: %.0f" % (
  statistics.median([r[2] for r in single if r[2]]), statistics.median([r[3-1] for r in multi if r[2]])))
log("median desc_chars single-copy: %.0f | multi-copy: %.0f" % (
  statistics.median([r[3] for r in single if r[3] is not None]), statistics.median([r[3] for r in multi if r[3] is not None])))

log("== B. location_class ==")
for r in cur.execute("SELECT location_class, COUNT(*) FROM artifacts GROUP BY location_class ORDER BY 2 DESC LIMIT 8"): log(r)

log("== C. compressibility: intra-repo line redundancy ==")
repos=[r[0] for r in cur.execute("""SELECT repo_full_name FROM artifacts WHERE content_fetched=1
 GROUP BY repo_full_name HAVING COUNT(*) BETWEEN 8 AND 40 ORDER BY COUNT(*) DESC LIMIT 300""")]
log("candidate repos:", len(repos))
MARK = re.compile(r'^\s*(#|```|---|\*\*|-|\*|\d+\.)')
fracs=[]; boiler=0; tot=0; used=0
for repo in repos:
    bodies=[r[0] for r in cur.execute("SELECT content FROM artifacts WHERE repo_full_name=? AND content_fetched=1 LIMIT 40",(repo,)) if r[0]]
    if len(bodies)<8: continue
    per=[[l.strip() for l in b.splitlines() if l.strip()] for b in bodies]
    total=sum(len(ls) for ls in per)
    if not total: continue
    cnt=collections.Counter(l for ls in per for l in set(ls))
    dup=sum(sum(1 for l in ls if cnt[l]>1) for ls in per)
    fracs.append(dup/total); boiler+=sum(1 for ls in per for l in ls if MARK.match(l)); tot+=total; used+=1
    if used%50==0: log(" ...", used, "repos")
log("repos analysed:", used)
s=f"mean {100*statistics.mean(fracs):.1f}% | median {100*statistics.median(fracs):.1f}% | p90 {100*sorted(fracs)[int(.9*len(fracs))]:.1f}%"
log("intra-repo line redundancy:", s)
log("markdown-structure line share: %.1f%%" % (100*boiler/tot))
