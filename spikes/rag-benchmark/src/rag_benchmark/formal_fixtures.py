from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
from typing import Any

from .contracts import SourceDocument


PROJECT_ID = "formal-fixture-project-001"
FORMAL_SCALES = (100_000, 1_000_000, 5_000_000)
QUERY_COUNT = 120

ZH_NEAR_SYNONYM_CLUES = (
    ("绯红色", "深红色"),
    ("天青色", "天空蓝"),
    ("象牙白", "乳白色"),
    ("乌木黑", "墨黑色"),
    ("翡翠绿", "宝石绿"),
    ("琥珀黄", "蜂蜜黄"),
    ("堇紫色", "紫罗兰色"),
    ("朱红色", "火焰红"),
    ("松石青", "蓝绿色"),
    ("银灰色", "金属灰"),
)

EN_NEAR_SYNONYM_CLUES = (
    ("crimson", "deep-red"),
    ("azure", "sky-blue"),
    ("ivory", "off-white"),
    ("ebony", "jet-black"),
    ("emerald", "jewel-green"),
    ("amber", "honey-yellow"),
    ("violet", "royal-purple"),
    ("scarlet", "flame-red"),
    ("turquoise", "blue-green"),
    ("silver", "metallic-gray"),
)


def _anchor(index: int) -> tuple[str, str, dict[str, Any]]:
    number = index + 1
    code = f"K-{number:03d}-AC"
    if index < QUERY_COUNT // 2:
        path = f"zh/第{number:03d}章/01-线索.md"
        person = f"记录员{number:03d}"
        place = f"北港{number:03d}号仓库"
        if index % 6 == 0:
            source_clue, query_clue = ZH_NEAR_SYNONYM_CLUES[index // 6]
            evidence = (
                f"{person}把一枚{source_clue}的铜制航标存入"
                f"{place}的第{number % 17 + 1}格。"
            )
            query = f"谁保管了{query_clue}的古铜导航标记？"
            case = "near-synonym"
        else:
            evidence = f"{person}把刻有编号 {code} 的铜制航标存入{place}的第{number % 17 + 1}格。"
            query = f"编号 {code} 的航标在哪里"
            case = "identifier"
        language = "zh"
        title = f"# 航线记录 {number:03d}"
    else:
        path = f"en/chapter-{number:03d}/01-clue.md"
        person = f"Archivist {number:03d}"
        place = f"North Quay vault {number:03d}"
        if index % 6 == 0:
            source_clue, query_clue = EN_NEAR_SYNONYM_CLUES[
                (index - QUERY_COUNT // 2) // 6
            ]
            evidence = (
                f"{person} stored the {source_clue} brass beacon in drawer "
                f"{number % 17 + 1} of {place}."
            )
            query = f"Who secured the {query_clue} bronze navigation marker?"
            case = "near-synonym"
        else:
            evidence = (
                f"{person} stored the brass beacon marked {code} in drawer "
                f"{number % 17 + 1} of {place}."
            )
            query = f"Where is the beacon marked {code}?"
            case = "identifier"
        language = "en"
        title = f"# Route Record {number:03d}"

    content = f"{title}\n\n{evidence}\n"
    label = {
        "id": f"formal-{number:03d}",
        "language": language,
        "query": query,
        "case": case,
        "expected_sources": [{"path": path, "contains": evidence}],
        "review": {"status": "pending", "reviewed_by": None, "reviewed_at": None},
    }
    return path, content, label


def _filler(seed: int, minimum_characters: int) -> str:
    paragraphs: list[str] = []
    current = 0
    counter = 0
    while current < minimum_characters:
        line = (
            f"背景记录 {seed:03d}-{counter:04d}：潮汐、车站灯光与季节性风向构成普通叙事细节，"
            "不包含任何航标编号。 "
            f"Background note {seed:03d}-{counter:04d} describes weather, travel, and routine "
            "inventory without a labeled retrieval fact."
        )
        paragraphs.append(line)
        current += len(line) + 2
        counter += 1
    return "\n\n".join(paragraphs) + "\n"


def generate_formal_fixture(destination: Path, target_characters: int) -> dict[str, Any]:
    if target_characters not in FORMAL_SCALES:
        raise ValueError(f"Unsupported formal scale: {target_characters}")
    if destination.exists():
        shutil.rmtree(destination)
    corpus_dir = destination / "corpus"
    corpus_dir.mkdir(parents=True)

    queries: list[dict[str, Any]] = []
    character_count = 0
    for index in range(QUERY_COUNT):
        relative_path, content, label = _anchor(index)
        path = corpus_dir / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        character_count += len(content)
        queries.append(label)

    filler_index = 0
    while character_count < target_characters:
        remaining = target_characters - character_count
        content = _filler(filler_index, min(20_000, remaining))[:remaining]
        path = corpus_dir / "background" / f"{filler_index:04d}-notes.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
        character_count += len(content)
        filler_index += 1

    (destination / "queries.json").write_text(
        json.dumps(queries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (destination / "review-template.json").write_text(
        json.dumps(review_template(queries), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    manifest = {
        "fixture_version": 1,
        "classification": "formal-scale-synthetic-labels",
        "project_id": PROJECT_ID,
        "target_characters": target_characters,
        "characters": character_count,
        "documents": len(list(corpus_dir.rglob("*.md"))),
        "queries": len(queries),
        "label_review": "pending",
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
    paths = sorted((destination / "corpus").rglob("*.md")) + [
        destination / "queries.json"
    ]
    for path in paths:
        digest.update(path.relative_to(destination).as_posix().encode("utf-8"))
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


def query_set_sha256(queries: list[dict[str, Any]]) -> str:
    canonical = [
        {
            "id": query["id"],
            "language": query["language"],
            "query": query["query"],
            "case": query["case"],
            "expected_sources": query["expected_sources"],
        }
        for query in queries
    ]
    return hashlib.sha256(
        json.dumps(
            canonical,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def review_template(queries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "query_set_sha256": query_set_sha256(queries),
        "review_method": "",
        "reviewed_by": "",
        "reviewed_at": "",
        "authorized_by": "",
        "authorization_context": "",
        "decisions": {query["id"]: "pending" for query in queries},
    }
