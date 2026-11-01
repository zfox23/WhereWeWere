"""Pure helpers for the diarization service (no heavy imports, so they can be tested anywhere)."""

from __future__ import annotations

from typing import Any, Iterable


def annotation_to_turns(annotation: Any) -> list[dict]:
    """
    Turn a pyannote `Annotation` (anything with `itertracks(yield_label=True)`) into plain,
    time-ordered turns: [{"start": seconds, "end": seconds, "speaker": "SPEAKER_00"}, ...].
    Zero-length turns are dropped.
    """
    turns = [
        {"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "speaker": str(label)}
        for segment, _track, label in annotation.itertracks(yield_label=True)
        if float(segment.end) > float(segment.start)
    ]
    turns.sort(key=lambda t: (t["start"], t["end"]))
    return turns


def speakers_in_order(turns: Iterable[dict]) -> list[str]:
    """Distinct speaker labels in order of first appearance."""
    seen: list[str] = []
    for t in turns:
        if t["speaker"] not in seen:
            seen.append(t["speaker"])
    return seen


def speaker_bounds(num_speakers: int | None, min_speakers: int | None, max_speakers: int | None) -> dict:
    """
    The keyword arguments to hand to the pipeline. An exact count wins over a range; values
    below 1 are ignored; a reversed range is put the right way round.
    """
    def ok(v: int | None) -> int | None:
        return v if isinstance(v, int) and v >= 1 else None

    n, lo, hi = ok(num_speakers), ok(min_speakers), ok(max_speakers)
    if n is not None:
        return {"num_speakers": n}
    if lo is not None and hi is not None and lo > hi:
        lo, hi = hi, lo
    out: dict = {}
    if lo is not None:
        out["min_speakers"] = lo
    if hi is not None:
        out["max_speakers"] = hi
    return out
