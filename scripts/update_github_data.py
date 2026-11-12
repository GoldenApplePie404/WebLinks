# -*- coding: utf-8 -*-
"""生成 GitHub 收录仓库的数据快照 json/github-data.json

由 GitHub Actions 每日定时（及 github.json 变更时）调用，
使用 Actions 自带的 GITHUB_TOKEN，配额 5000 次/小时，远超收录量。
冗余策略：拉取失败的项目保留快照中的旧数据，不会清空。
仅用标准库，无需安装依赖。
"""
import json
import os
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "json", "github.json")
OUT = os.path.join(ROOT, "json", "github-data.json")

FIELDS = (
    "full_name html_url description stargazers_count forks_count "
    "open_issues_count language topics pushed_at archived"
).split()


def fetch_repo(repo: str) -> dict:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "weblink-data-sync",
            **({"Authorization": f"Bearer {os.environ['GH_TOKEN']}"}
               if os.environ.get("GH_TOKEN") else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        d = json.load(resp)
    return {k: d.get(k) for k in FIELDS} | {
        "topics": d.get("topics") or [],
        "archived": bool(d.get("archived")),
        "license": (d.get("license") or {}).get("spdx_id"),
    }


def main() -> None:
    with open(SRC, encoding="utf-8") as f:
        entries = json.load(f).get("repos", [])

    # 冗余：以旧快照为基础，成功覆盖、失败保留
    old_repos = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                old_repos = json.load(f).get("repos", {})
        except (json.JSONDecodeError, OSError):
            old_repos = {}

    now_ms = int(time.time() * 1000)
    repos = dict(old_repos)
    failed = []

    for entry in entries:
        repo = entry["repo"]
        try:
            repos[repo] = {"fetched_at": now_ms, "data": fetch_repo(repo)}
            print(f"ok   {repo}")
        except Exception as exc:  # 网络/限流/仓库不存在时保留旧数据
            if repo in repos:
                print(f"keep {repo}（沿用旧快照）: {exc}")
            else:
                failed.append(repo)
                print(f"fail {repo}: {exc}")

    snapshot = {"generated_at": now_ms, "repos": repos}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    f2 = json.dumps(snapshot, ensure_ascii=False)
    print(f"written: {OUT}（{len(repos)} 个仓库，{len(f2) // 1024} KB）")

    if failed:
        print(f"WARNING: {len(failed)} 个仓库首次拉取失败: {', '.join(failed)}")


if __name__ == "__main__":
    main()
