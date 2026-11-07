#!/usr/bin/env python3
"""Regenerate the sitemap served by the deployed web container.

Runs from cron on the deploy host. Reads the deployed blog content, writes
/opt/btcusd-tester/ops/sitemap/sitemap.xml (bind-mounted into the web
container) and verifies the live response. Exits non-zero on inconsistency.
"""

from datetime import date
import os
import re
import subprocess

BASE_URL = "https://grailab.top"
CONTENT_DIR = "/opt/btcusd-tester/frontend/content/blog"
OUTPUT = "/opt/btcusd-tester/ops/sitemap/sitemap.xml"
ORIGIN = "http://127.0.0.1:8083/sitemap.xml"
STATIC_PATHS = ("/", "/blog", "/terms", "/privacy")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def frontmatter(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if not text.startswith("---"):
        raise ValueError(f"{os.path.basename(path)}: missing frontmatter")
    fields = {}
    for line in text.splitlines()[1:]:
        if line.strip() == "---":
            return fields
        key, separator, value = line.partition(":")
        if separator:
            fields[key.strip()] = value.strip().strip("\"'")
    raise ValueError(f"{os.path.basename(path)}: unterminated frontmatter")


def read_articles():
    articles = []
    seen = set()
    for name in sorted(os.listdir(CONTENT_DIR)):
        if not name.endswith(".md") or name == "README.md" or name.startswith("_"):
            continue
        fields = frontmatter(os.path.join(CONTENT_DIR, name))
        if fields.get("draft", "false").lower() == "true":
            continue
        slug = fields.get("slug", "")
        published = fields.get("publishedAt", "")
        if not SLUG.fullmatch(slug):
            raise ValueError(f"{name}: invalid slug {slug!r}")
        if slug in seen:
            raise ValueError(f"{name}: duplicate slug {slug!r}")
        seen.add(slug)
        if not DATE.fullmatch(published):
            raise ValueError(f"{name}: invalid publishedAt {published!r}")
        try:
            date.fromisoformat(published)
        except ValueError as error:
            raise ValueError(f"{name}: invalid publishedAt {published!r}") from error
        articles.append((slug, published))
    return articles


def render(articles):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path in STATIC_PATHS:
        lines += ["  <url>", f"    <loc>{BASE_URL}{path}</loc>", "  </url>"]
    for slug, published in articles:
        lines += [
            "  <url>",
            f"    <loc>{BASE_URL}/blog/{slug}</loc>",
            f"    <lastmod>{published}</lastmod>",
            "  </url>",
        ]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    articles = read_articles()
    document = render(articles)
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    # Write in place: the running container bind-mounts this exact file, and
    # replacing it with os.replace() would leave the mount on the old inode.
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(document)
        handle.flush()
        os.fsync(handle.fileno())
    served = subprocess.run(
        ["curl", "-fsS", "--max-time", "10", ORIGIN],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if served != document:
        raise SystemExit("live sitemap differs from the generated document")
    print(f"sitemap updated: {len(STATIC_PATHS)} static routes, {len(articles)} articles")


if __name__ == "__main__":
    main()
