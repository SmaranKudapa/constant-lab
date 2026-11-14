"""The lab's event log. Every agent action is one JSON line; the viewer and the pitch read only this.
Format: docs/LOG_FORMAT.md.  Usage:  from constant_lab.events import emit;  emit("KEEP", peak="16a", agent="Serac", score="2.15622...")"""
import json, os, threading, datetime

LOG_PATH = os.environ.get("CONSTANT_LAB_LOG", "/data/events.jsonl")  # /data is the Modal Volume mount
_lock = threading.Lock()

def _next_seq(path):
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f) + 1
    except FileNotFoundError:
        return 1

def emit(type: str, **fields) -> dict:
    """Append one event. Scores must be passed as strings so no digits are lost."""
    with _lock:
        os.makedirs(os.path.dirname(LOG_PATH) or ".", exist_ok=True)
        event = {"seq": _next_seq(LOG_PATH), "t": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z", "type": type, **fields}
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event

def read_since(seq: int = 0, path: str | None = None) -> list[dict]:
    out = []
    try:
        with open(path or LOG_PATH, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    e = json.loads(line)
                    if e.get("seq", 0) > seq:
                        out.append(e)
    except FileNotFoundError:
        pass
    return out
