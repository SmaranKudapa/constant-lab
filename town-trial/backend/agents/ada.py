"""Ada, the researcher: Exa search in the main loop, then grounded extraction.

- search(): one Exa call (counts against the trial's Exa budget), keeps each
  result's URL, title and the passage (highlights) it found.
- extract(): the LLM may return a value only if a returned passage states it,
  and must quote that passage. The quote is verified in code against the
  passages; an unverified quote is treated as "not found" (a logged gap).
"""
from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from agents.llm import LLM, Budget, strict

EXA_TIMEOUT_S = 25
CHANNELS = ["online", "board", "bulletin"]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[“”\"'’`*#_]", "", s or "")).strip().lower()


class Ada:
    def __init__(self, budget: Budget, llm: LLM):
        self.budget, self.llm = budget, llm
        self.exa = None
        if os.environ.get("EXA_API_KEY"):
            from exa_py import Exa
            self.exa = Exa(os.environ["EXA_API_KEY"])

    @property
    def available(self) -> bool:
        return self.exa is not None

    def search(self, query: str, num_results: int = 3) -> list[dict]:
        """Raises on missing key, budget, timeout or API error (the caller logs it and uses a fixture)."""
        if not self.exa:
            raise RuntimeError("EXA_API_KEY not set")
        self.budget.take("exa")
        with ThreadPoolExecutor(1) as ex:
            fut = ex.submit(self.exa.search_and_contents, query, num_results=num_results,
                            highlights={"num_sentences": 3, "highlights_per_url": 2}, text={"max_characters": 2000})
            try:
                resp = fut.result(timeout=EXA_TIMEOUT_S)
            except FutureTimeout:
                raise TimeoutError(f"Exa timed out after {EXA_TIMEOUT_S}s")
        out = []
        for r in resp.results:
            hl = " … ".join(h.strip() for h in (getattr(r, "highlights", None) or []) if h.strip())
            text = (getattr(r, "text", None) or "").strip()
            out.append({"title": r.title or r.url, "url": r.url, "passage": (hl or text)[:600],
                        "published": getattr(r, "published_date", None), "_text": text})
        return out

    @staticmethod
    def public(results: list[dict]) -> list[dict]:
        """What goes into the EXA event (drops the long page text)."""
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]

    def _verify(self, quote: str, url: str, results: list[dict]) -> dict | None:
        q = _norm(quote)
        if len(q) < 12:
            return None
        for r in results:
            if q in _norm(r["passage"]) or q in _norm(r.get("_text", "")):
                return r
        return None

    def _sources(self, results: list[dict]) -> str:
        return "\n\n".join(f"[{i + 1}] {r['title']}\nURL: {r['url']}\nPASSAGE: {r['passage']}\nPAGE TEXT: {r.get('_text', '')[:1500]}"
                           for i, r in enumerate(results))

    SYSTEM = ("You extract facts for a local-policy simulation. Use ONLY the sources given. "
              "If no source explicitly states the fact, set found=false. Never infer, generalise from other towns, or use background knowledge. "
              "When found=true, `quote` must be copied verbatim from one source (one or two sentences) and `url` must be that source's URL.")

    def extract_hours(self, city: str, results: list[dict]) -> dict | None:
        schema = strict({
            "found": {"type": "boolean"},
            "days": {"type": "array", "items": strict({"day": {"type": "integer", "description": "0=Mon .. 6=Sun"},
                                                       "open": {"type": ["string", "null"], "description": "HH:MM 24h, null if closed"},
                                                       "close": {"type": ["string", "null"]}})},
            "quote": {"type": "string"}, "url": {"type": "string"},
        })
        out = self.llm.json("library_hours", schema, self.SYSTEM,
                            f"What are the current weekly opening hours of the main public library in {city}? Give all 7 days.\n\n{self._sources(results)}")
        return self._checked(out, results)

    def extract_constraint(self, city: str, question: str, results: list[dict]) -> dict | None:
        schema = strict({
            "found": {"type": "boolean"},
            "kind": {"type": "string", "enum": ["no_additional_staff_hours", "staff_hours_cap", "budget_cut", "other", "none"]},
            "hours_per_week": {"type": ["number", "null"], "description": "only for staff_hours_cap: total library staff hours per week allowed"},
            "statement": {"type": "string", "description": "the constraint in one short sentence"},
            "quote": {"type": "string"}, "url": {"type": "string"},
        })
        out = self.llm.json("staffing_constraint", schema, self.SYSTEM,
                            f"Question: {question}\nDoes any source state a staffing or budget limit for the {city} library's opening hours "
                            f"(e.g. no additional staff hours, a cap on staff hours, a budget cut)?\n\n{self._sources(results)}")
        return self._checked(out, results)

    def extract_channels(self, city: str, question: str, results: list[dict]) -> dict | None:
        schema = strict({
            "found": {"type": "boolean"},
            "channels": {"type": "array", "items": {"type": "string", "enum": CHANNELS},
                         "description": "online = website/social/email from the library; board = a public notice board; bulletin = a school newsletter/bulletin to families"},
            "statement": {"type": "string"}, "quote": {"type": "string"}, "url": {"type": "string"},
        })
        out = self.llm.json("notice_channels", schema, self.SYSTEM,
                            f"Question: {question}\nWhich of these channels does a source show exist in {city} for reaching residents: "
                            f"online, board, bulletin?\n\n{self._sources(results)}")
        out = self._checked(out, results)
        if out:
            out["channels"] = [c for c in dict.fromkeys(out["channels"]) if c in CHANNELS]
            if not out["channels"]:
                return None
        return out

    def _checked(self, out: dict, results: list[dict]) -> dict | None:
        if not out.get("found"):
            return None
        src = self._verify(out.get("quote", ""), out.get("url", ""), results)
        if not src:
            return {"unverified": True, **out}
        out["url"] = src["url"]  # trust the verified source, not the model's URL
        out["title"] = src["title"]
        return out
