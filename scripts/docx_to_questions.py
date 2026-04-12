#!/usr/bin/env python3
"""
Import Sergeant exam MCQs from Word (.docx).

This document uses paragraph styles (not character bold) to mark the correct
answer: the correct choice is styled Heading1; distractors are ListParagraph.
Stem text uses BodyText (possibly multiple consecutive paragraphs).

Output JSON uses canonical choice order [Heading1, List1, List2] with
correctIndex 0. The web app shuffles choices when displaying each question.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

try:
    from docx import Document
except ImportError as e:  # pragma: no cover
    raise SystemExit("Install dependency: pip install python-docx") from e


def is_intro_paragraph(text: str) -> bool:
    tl = text.lower()
    return "exam consists" in tl and "100 randomly" in tl


def iter_blocks(doc_path: Path) -> list[tuple[str, list[str]]]:
    doc = Document(str(doc_path))
    rows: list[tuple[str, str]] = []
    for p in doc.paragraphs:
        text = "".join(run.text for run in p.runs).strip()
        if not text:
            continue
        ppr = p.paragraph_format
        style = p.style.name if p.style is not None else None
        rows.append((style or "-", text))

    blocks: list[tuple[str, list[str]]] = []
    i = 0
    while i < len(rows):
        st, tx = rows[i]
        if st != "Body Text":
            i += 1
            continue
        stem_parts: list[str] = []
        while i < len(rows) and rows[i][0] == "Body Text":
            stem_parts.append(rows[i][1])
            i += 1
        if stem_parts and is_intro_paragraph(stem_parts[0]):
            stem_parts = stem_parts[1:]
        if not stem_parts:
            continue
        stem = "\n".join(stem_parts).strip()
        opts: list[str] = []
        while i < len(rows):
            s2, t2 = rows[i]
            if s2 == "Heading 1":
                opts.append(t2)
                i += 1
            elif s2 == "List Paragraph":
                opts.append(t2)
                i += 1
            else:
                break
        if len(opts) >= 2:
            blocks.append((stem, opts))
    return blocks


def normalize_stem(stem: str) -> str:
    stem = re.sub(r"[ \t]+", " ", stem)
    return stem.strip()


def build_exam(docx_path: Path) -> dict:
    raw = iter_blocks(docx_path)
    questions = []
    for stem, opts in raw:
        stem = normalize_stem(stem)
        if len(opts) != 3:
            continue
        h = hashlib.sha256(stem.encode("utf-8")).hexdigest()[:12]
        n = len(questions) + 1
        questions.append(
            {
                "id": f"q{n:03d}-{h}",
                "text": stem,
                "choices": opts[:3],
                "correctIndex": 0,
            }
        )
    return {
        "examId": "sgt-march-2026",
        "title": "Sergeant Exam (March 2026)",
        "version": 2,
        "sourceNote": "Imported from Word; 'Heading 1' style = correct answer (choices[0], correctIndex 0). The app shuffles choices when you take a quiz.",
        "questions": questions,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "docx",
        type=Path,
        nargs="?",
        default=None,
        help="Path to .docx (default: Sergeant Exam - March 2026.docx next to sgt-exam-practice/)",
    )
    ap.add_argument("-o", "--out", type=Path, required=True)
    args = ap.parse_args()
    docx = args.docx
    if docx is None:
        docx = (
            Path(__file__).resolve().parents[2]
            / "Sergeant Exam - March 2026.docx"
        )
    exam = build_exam(docx.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(exam, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(exam['questions'])} questions to {args.out}")


if __name__ == "__main__":
    main()
