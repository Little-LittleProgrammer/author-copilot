from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
from typing import Any

from .contracts import SourceDocument


PROJECT_ID = "fixture-project-001"

CORPUS: dict[str, str] = {
    "zh/第一卷/第一章/01-雨夜重逢.md": """# 归来

林澈撑着一把靛蓝色雨伞，在北站第三站台等待沈砚。雨水沿着旧钟楼的铜檐滴落。

沈砚迟到了七分钟。他递给林澈一枚刻着燕子纹样的黄铜钥匙，并说钥匙属于河西旧邮局的三号信箱。
""",
    "zh/第一卷/第二章/01-观星台.md": """# 归来

废弃观星台的旋梯下藏着一枚银色罗盘。顾遥在罗盘背面看见日期：九月十七日。

窗边的白色山茶花已经枯萎，花盆底部压着通往盐井的手绘地图。
""",
    "zh/第二卷/第一章/01-盐井.md": """# 盐井

盐井守门人也保存着一枚银色罗盘，指针始终朝向废弃观星台。

井壁第十二级石阶刻着一句话：潮汐退去时，从东门离开。
""",
    "zh/第二卷/第二章/01-短信.md": """# 短讯

顾遥只写了一句：黎明前不要开东门。
""",
    "en/book-one/chapter-01/01-arrival.md": """# Homecoming

Mara hid the brass compass beneath the cracked observatory stair before dawn. Only Elias knew the compartment existed.

The station clock had stopped at 04:17, although every watch on the platform still kept time.
""",
    "en/book-two/chapter-03/01-return.md": """# Homecoming

Elias carried a cobalt notebook into the archive. Page forty-two listed the harbor master's private radio frequency.

At sunset, he left the notebook inside locker nineteen and mailed the key to Mara.
""",
    "en/book-two/chapter-04/01-long-ledger.md": """# The Ledger

"""
    + "\n\n".join(
        f"Ledger entry {number:02d} records supply crates delivered to North Quay warehouse {number % 4 + 1}."
        for number in range(1, 25)
    )
    + "\n",
}

QUERIES: list[dict[str, Any]] = [
    {
        "id": "zh-exact-platform",
        "language": "zh",
        "query": "北站第三站台",
        "case": "exact",
        "expected_sources": [
            {"path": "zh/第一卷/第一章/01-雨夜重逢.md", "contains": "北站第三站台"}
        ],
    },
    {
        "id": "zh-exact-key",
        "language": "zh",
        "query": "燕子纹样的黄铜钥匙",
        "case": "short-chapter",
        "expected_sources": [
            {"path": "zh/第一卷/第一章/01-雨夜重逢.md", "contains": "燕子纹样的黄铜钥匙"}
        ],
    },
    {
        "id": "zh-cross-file-compass",
        "language": "zh",
        "query": "银色罗盘",
        "case": "cross-file",
        "expected_sources": [
            {"path": "zh/第一卷/第二章/01-观星台.md", "contains": "银色罗盘"},
            {"path": "zh/第二卷/第一章/01-盐井.md", "contains": "银色罗盘"},
        ],
    },
    {
        "id": "zh-duplicate-title",
        "language": "zh",
        "query": "九月十七日",
        "case": "duplicate-title",
        "expected_sources": [
            {"path": "zh/第一卷/第二章/01-观星台.md", "contains": "九月十七日"}
        ],
    },
    {
        "id": "zh-short",
        "language": "zh",
        "query": "黎明前不要开东门",
        "case": "short-chapter",
        "expected_sources": [
            {"path": "zh/第二卷/第二章/01-短信.md", "contains": "黎明前不要开东门"}
        ],
    },
    {
        "id": "zh-near-synonym",
        "language": "zh",
        "query": "深蓝雨具是谁拿着的",
        "case": "near-synonym",
        "expected_sources": [
            {"path": "zh/第一卷/第一章/01-雨夜重逢.md", "contains": "靛蓝色雨伞"}
        ],
    },
    {
        "id": "en-exact-compass",
        "language": "en",
        "query": "brass compass cracked observatory stair",
        "case": "exact",
        "expected_sources": [
            {"path": "en/book-one/chapter-01/01-arrival.md", "contains": "brass compass"}
        ],
    },
    {
        "id": "en-duplicate-title",
        "language": "en",
        "query": "cobalt notebook archive",
        "case": "duplicate-title",
        "expected_sources": [
            {"path": "en/book-two/chapter-03/01-return.md", "contains": "cobalt notebook"}
        ],
    },
    {
        "id": "en-long-chapter",
        "language": "en",
        "query": "Ledger entry 23 North Quay",
        "case": "long-chapter",
        "expected_sources": [
            {"path": "en/book-two/chapter-04/01-long-ledger.md", "contains": "Ledger entry 23"}
        ],
    },
    {
        "id": "en-near-synonym",
        "language": "en",
        "query": "Where was the blue journal stored?",
        "case": "near-synonym",
        "expected_sources": [
            {"path": "en/book-two/chapter-03/01-return.md", "contains": "cobalt notebook"}
        ],
    },
]


def generate_fixture(destination: Path) -> dict[str, Any]:
    """Replace destination with a byte-for-byte deterministic fixture."""
    if destination.exists():
        shutil.rmtree(destination)
    corpus_dir = destination / "corpus"
    corpus_dir.mkdir(parents=True)
    for relative_path, content in sorted(CORPUS.items()):
        path = corpus_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
    (destination / "queries.json").write_text(
        json.dumps(QUERIES, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    manifest = {
        "fixture_version": 1,
        "project_id": PROJECT_ID,
        "documents": len(CORPUS),
        "queries": len(QUERIES),
        "sha256": fixture_sha256(destination),
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return manifest


def fixture_sha256(destination: Path) -> str:
    digest = hashlib.sha256()
    paths = sorted((destination / "corpus").rglob("*.md")) + [destination / "queries.json"]
    for path in paths:
        relative = path.relative_to(destination).as_posix()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def load_documents(destination: Path) -> list[SourceDocument]:
    corpus_dir = destination / "corpus"
    return [
        SourceDocument(
            project_id=PROJECT_ID,
            source_path=path.relative_to(corpus_dir).as_posix(),
            content=path.read_text(encoding="utf-8"),
        )
        for path in sorted(corpus_dir.rglob("*.md"))
    ]


def load_queries(destination: Path) -> list[dict[str, Any]]:
    return json.loads((destination / "queries.json").read_text(encoding="utf-8"))

