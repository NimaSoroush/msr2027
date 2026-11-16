"""Pilot analysis for the MSR 2027 challenge paper on context compression of SKILL.md.

Part A  corpus-scale "context cost" of skills (metadata only, analysis/meta.db)
Part B  content-level compressibility on a sample of distinct skills (44GB db, read-only)
Part C  routing feasibility: how many skills a selector must choose among
Run: python3 analysis/pilot2.py
"""
import sqlite3, re, statistics, json, random, collections

META = "analysis/meta.db"
FULL = "agent_skills_release.db"

def pctl(vals, ps=(50, 75, 90, 95, 99, 99.9)):
    v = sorted(vals); n = len(v)
    return {p: v[min(n - 1, max(0, int(round(p / 100 * (n - 1)))))] for p in ps}

def hdr(t):
    print("\n" + "=" * 70 + "\n" + t + "\n" + "=" * 70, flush=True)

con = sqlite3.connect(META)
cur = con.cursor()

hdr("A1. Population and content coverage")
tot, fetched, reps = cur.execute(
    "SELECT COUNT(*), SUM(content_fetched=1), SUM(dedup_primary=1) FROM art").fetchone()
print(f"skill file occurrences : {tot:,}")
print(f"with full text          : {fetched:,} ({100*fetched/tot:.1f}%)")
print(f"distinct contents (dedup_primary=1): {reps:,}")

hdr("A2. Size of the artifact an agent must load (body_chars)")
bc = [r[0] for r in cur.execute(
    "SELECT body_chars FROM art WHERE content_fetched=1 AND body_chars IS NOT NULL AND body_chars>0")]
print(f"n={len(bc):,}  mean={statistics.mean(bc):.0f}  median={statistics.median(bc):.0f}")
print("percentiles:", pctl(bc))
for t in (2000, 4000, 8000, 16000, 32000, 100000):
    k = sum(1 for x in bc if x > t)
    print(f"  > {t:>6} chars (~{t//4:>5} tok): {k:>9,} ({100*k/len(bc):5.2f}%)")
print(f"total body text if all loaded once: {sum(bc)/1e9:.2f} GB (~{sum(bc)/4e9:.2f} B tokens)")

hdr("A3. Description = the string the selector matches against")
desc_all = [r[0] for r in cur.execute(
    "SELECT desc_chars FROM art WHERE content_fetched=1 AND desc_chars IS NOT NULL")]
print(f"n={len(desc_all):,}  mean={statistics.mean(desc_all):.0f}  median={statistics.median(desc_all):.0f}")
print("percentiles:", pctl(desc_all))
for t in (100, 200, 500, 1024):
    k = sum(1 for x in desc_all if x > t)
    print(f"  > {t:>5} chars: {k:>9,} ({100*k/len(desc_all):5.2f}%)")
print(f"description/body size ratio (median): {statistics.median(desc_all)/max(1,statistics.median(bc)):.3f}")

hdr("A4. Bundled payload next to the skill (siblings)")
sib = cur.execute("""SELECT
  SUM(has_scripts=1), SUM(has_references=1), SUM(COALESCE(sibling_count,0)>0),
  SUM(COALESCE(sibling_bytes,0)), AVG(CASE WHEN sibling_count>0 THEN sibling_bytes END),
  MAX(COALESCE(sibling_bytes,0))
  FROM art WHERE content_fetched=1""").fetchone()
print(f"skills with scripts     : {sib[0]:,}")
print(f"skills with references  : {sib[1]:,}")
print(f"skills with siblings    : {sib[2]:,}")
print(f"mean sibling bytes (when any): {sib[4] or 0:,.0f}  max: {sib[5]:,}")

hdr("A5. Routing feasibility: candidate-set size per repository")
sizes = [r[0] for r in cur.execute(
    "SELECT n FROM (SELECT repo_full_name, COUNT(*) n FROM art WHERE content_fetched=1 GROUP BY 1)")]
print(f"repos with text: {len(sizes):,}  skills/repo percentiles: {pctl(sizes)}")
for t in (5, 10, 25, 50, 100, 500):
    print(f"  repos with >= {t:>3} skills: {sum(1 for s in sizes if s >= t):,}")

hdr("A6. Reuse concentration (compression already happens by copying)")
print("file_sha NULL rows:", cur.execute("SELECT COUNT(*) FROM art WHERE file_sha IS NULL").fetchone()[0])
copies = [r[0] for r in cur.execute(
    "SELECT n FROM (SELECT file_sha, COUNT(*) n FROM art GROUP BY 1)")]
copies.sort(reverse=True)
print(f"distinct contents: {len(copies):,}; occurrences: {sum(copies):,}")
print(f"copied >1x: {sum(1 for c in copies if c>1):,} ({100*sum(1 for c in copies if c>1)/len(copies):.1f}% of contents)")
print(f"occurrences that are verbatim copies: {100*(sum(copies)-len(copies))/sum(copies):.1f}%")
print("top copy counts:", copies[:10])
for k in (1, 10):
    print(f"  top {k}% contents hold {100*sum(copies[:max(1,len(copies)*k//100)])/sum(copies):.1f}% of occurrences")

hdr("A7. Maintenance signal available for a longitudinal design")
cc = [r[0] for r in cur.execute(
    "SELECT commit_count FROM art WHERE content_fetched=1 AND commit_count IS NOT NULL")]
print(f"skills with commit history: {len(cc):,}  median commits: {statistics.median(cc):.0f}  p90: {pctl(cc)[90]}")
print(f"skills edited >=2 times: {sum(1 for x in cc if x>=2):,} ({100*sum(1 for x in cc if x>=2)/len(cc):.1f}%)")

# ---------------------------------------------------------------- Part B
hdr("B. Content-level compressibility (sample of distinct skills)")
random.seed(20261223)
full = sqlite3.connect(f"file:{FULL}?mode=ro", uri=True)
full.text_factory = str
fc = full.cursor()

SAMPLE = 4000
rows = fc.execute(
    """SELECT content, name, description FROM artifacts
       WHERE content_fetched=1 AND dedup_primary=1 AND body_chars BETWEEN 400 AND 40000
         AND (rowid % 631) = 5
       LIMIT ?""", (SAMPLE,)).fetchall()
print(f"sample: {len(rows):,} distinct skills (400..40k chars, spread over the table)")

STOP = set("""a an the is are was were be been being am do does did have has had will would shall should can could may might must
just really very basically simply actually quite rather please kindly just also however moreover furthermore therefore thus
you your we our it its this that these those there here of to in on at for with from by as and or but if then so such
i me my he she they them his her their what which who whom when where why how all any both each few more most other some
""".split())

DECOR = re.compile(r"^(#+\s*|[-*+]\s+|\d+\.\s+|\|.*\||```.*$|>+\s*|---+\s*$|\*\*|\*|`+|_+)")
LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
CODE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`]*`")
FILLER = re.compile(r"\b(please|kindly|feel free to|make sure to|be sure to|it is important to|you should|you must|note that|remember that|in order to|as well as|at this point|in this case)\b", re.I)

def words(s):
    return re.findall(r"[A-Za-z0-9_][A-Za-z0-9_\-./]*", s)

def style_compress(s):
    """Approximate telegraphic ('caveman') rewriting: drop function words + decoration."""
    out = []
    for line in s.splitlines():
        line = DECOR.sub("", line)
        line = LINK.sub(r"\1", line)
        ws = [w for w in words(line) if w.lower() not in STOP]
        if ws:
            out.append(" ".join(ws))
    return "\n".join(out)

def strip_boiler(s):
    """Boilerplate/structure-only view: headings kept, prose paragraphs dropped."""
    keep = []
    for line in s.splitlines():
        if re.match(r"^\s{0,3}(#{1,6}\s|```|\|)", line) or re.match(r"^\s*([-*+]|\d+\.)\s", line):
            keep.append(line)
    return "\n".join(keep)

def heur_tokens(s):
    return len(s) / 4.0

def dup_lines(s):
    ls = [l.strip() for l in s.splitlines() if l.strip()]
    if not ls:
        return 0.0, 0
    c = collections.Counter(ls)
    return sum(1 for l in ls if c[l] > 1) / len(ls), len(ls)

def md_mix(s):
    code = sum(len(m) for m in CODE.findall(s))
    heads = sum(len(l) for l in s.splitlines() if re.match(r"^\s{0,3}#", l))
    return code / max(1, len(s)), heads / max(1, len(s))

style_r, strip_r, dup_r, code_share, desc_in_body, nlines = [], [], [], [], [], []
by_size = collections.defaultdict(list)
sec_dim = collections.Counter()
for content, name, desc in rows:
    if not content:
        continue
    body = content
    # strip YAML frontmatter for the body view
    if body.startswith("---"):
        parts = body.split("---", 2)
        if len(parts) == 3:
            body = parts[2]
    t0 = heur_tokens(body)
    if t0 < 50:
        continue
    style_r.append(1 - heur_tokens(style_compress(body)) / t0)
    strip_r.append(1 - heur_tokens(strip_boiler(body)) / t0)
    bkt = "<2k" if t0 < 2000 else "2-4k" if t0 < 4000 else "4-8k" if t0 < 8000 else ">=8k"
    by_size[bkt].append(100 * style_r[-1])
    dl, nl = dup_lines(body)
    dup_r.append(dl); nlines.append(nl)
    cs, _ = md_mix(body)
    code_share.append(cs)
    # does the body restate the vocabulary of the description (what the selector matches)?
    dterms = {w.lower() for w in words(desc or "") if len(w) > 3 and w.lower() not in STOP}
    if dterms:
        bterms = {w.lower() for w in words(body)}
        desc_in_body.append(len(dterms & bterms) / len(dterms))
    for h in re.findall(r"^\s{0,3}#{1,6}\s*(.+)$", body, re.M):
        key = h.strip().lower()[:40]
        for k in ("overview", "when to use", "instructions", "examples", "example", "workflow",
                  "guidelines", "best practices", "reference", "troubleshooting", "safety", "security",
                  "scripts", "resources", "output", "quick start", "usage", "notes", "pitfalls"):
            if k in key:
                sec_dim[k] += 1
                break
        else:
            sec_dim["(other)"] += 1

def rep(name, xs, fmt="{:.1f}"):
    xs = [x for x in xs if x is not None]
    print(f"{name:<46} mean={fmt.format(statistics.mean(xs))} median={fmt.format(statistics.median(xs))} "
          f"p90={fmt.format(sorted(xs)[int(.9*(len(xs)-1))])} n={len(xs):,}")

print(f"analysed skills: {len(style_r):,}")
rep("token reduction, telegraphic rewrite (%)", [100 * x for x in style_r])
rep("token reduction, structure-only (headings/lists) (%)", [100 * x for x in strip_r])
rep("intra-file repeated-line share (%)", [100 * x for x in dup_r])
rep("code-block char share (%)", [100 * x for x in code_share])
rep("description terms present in body (%)", [100 * x for x in desc_in_body])
print(f"median body lines: {statistics.median(nlines):.0f}")
print("heading topics (top 15):", sec_dim.most_common(15))
print("telegraphic reduction by skill size (tokens):")
for k in ("<2k", "2-4k", "4-8k", ">=8k"):
    xs = by_size.get(k, [])
    if xs:
        print(f"  {k:<6} n={len(xs):>5,}  mean={statistics.mean(xs):5.1f}%  median={statistics.median(xs):5.1f}%")

# --- worked example: what a telegraphic compressor actually removes from a real skill
ex = None
for content, name, desc in rows:
    if content and 1500 < len(content) < 3500 and "when to use" in content.lower():
        ex = (name, desc, content); break
if ex:
    name, desc, content = ex
    c = style_compress(content)
    print(f"\nworked example: {name!r} ({len(content)} chars -> {len(c)} chars, "
          f"{100*(1-len(c)/len(content)):.0f}% smaller)")
    print("first 700 chars of compressed body:\n" + c[:700])

hdr("B2. Compressing the router string (description): savings vs. lost identifiers")
IDENT = re.compile(r"(`[^`]+`|\b[\w.-]+/[\w./-]+|\b\w+\.(?:md|py|ts|js|json|ya?ml|sh|toml)\b|\b[A-Z]{2,}\b|\b\w+_\w+\b)")
red_desc, ident_loss = [], []
for content, name, desc in rows:
    if not desc or len(desc) < 40:
        continue
    ids = IDENT.findall(desc)
    comp = style_compress(desc)
    red_desc.append(100 * (1 - heur_tokens(comp) / max(1.0, heur_tokens(desc))))
    if ids:
        kept = sum(1 for i in ids if i.strip("`") in comp)
        ident_loss.append(100 * (1 - kept / len(ids)))
rep("description token reduction, telegraphic (%)", red_desc)
rep("named identifiers lost from description (%)", ident_loss)
print(f"descriptions carrying >=1 identifier: {len(ident_loss):,} of {len([1 for _,_,d in rows if d and len(d)>=40]):,}")

hdr("B3. What compression risks deleting (operational lines)")
OPS = re.compile(r"\b(run|execute|install|export|set|add|create|delete|remove|never|must|do not|don't|always|warning|caution|required|deprecated|version)\b", re.I)
CMD = re.compile(r"^\s*(\$|>|npm|npx|pip|bun|yarn|pnpm|git|curl|docker|kubectl|python|node)\b", re.I)
ops = []
for content, *_ in rows:
    if not content:
        continue
    ls = [l.strip() for l in content.splitlines() if l.strip()]
    if not ls:
        continue
    ops.append(sum(1 for l in ls if OPS.search(l) or CMD.match(l)) / len(ls))
rep("share of lines that are operational/constraint (%)", [100 * x for x in ops])

summary = {
    "occurrences": tot, "with_text": fetched, "distinct": reps,
    "median_body_chars": statistics.median(bc), "p90_body_chars": pctl(bc)[90],
    "median_desc_chars": statistics.median(desc_all),
    "telegraphic_reduction_pct": statistics.mean([100 * x for x in style_r]),
    "structure_only_reduction_pct": statistics.mean([100 * x for x in strip_r]),
    "dup_line_pct": statistics.mean([100 * x for x in dup_r]),
    "desc_terms_in_body_pct": statistics.mean([100 * x for x in desc_in_body]),
    "median_skills_per_repo": statistics.median(sizes),
}
json.dump(summary, open("analysis/pilot2_summary.json", "w"), indent=2)
print("\nwrote analysis/pilot2_summary.json")
