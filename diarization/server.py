"""
Speaker diarization service: "who spoke when", using pyannote.audio 3.1.

    GET  /health        { status: "ok" | "loading" | "error", pipeline_loaded, device, error? }
    POST /v1/diarize    multipart: file, [num_speakers], [min_speakers], [max_speakers]
                        -> { duration, speakers: [...], turns: [{ start, end, speaker }] }  (seconds)

The model is gated on Hugging Face: set HF_TOKEN (a read token) and accept the terms of
pyannote/speaker-diarization-3.1 and pyannote/segmentation-3.0 once, with that account.
The pipeline loads in the background at startup so /health answers immediately; /v1/diarize
returns 503 with the reason until it has loaded (or if it cannot).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from turns import annotation_to_turns, speaker_bounds, speakers_in_order

log = logging.getLogger("diarization")
logging.basicConfig(level=logging.INFO)

MODEL = os.environ.get("DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1")
TOKEN = os.environ.get("HF_TOKEN") or None

app = FastAPI(title="WhereWeWere diarization")

_state: dict = {"status": "loading", "pipeline": None, "error": None, "device": "cpu"}
# One diarization at a time: the pipeline is not safe to share between threads, and the GPU is the limit anyway.
_run_lock = threading.Lock()


def _load_pipeline() -> None:
    try:
        import torch
        from pyannote.audio import Pipeline

        if not TOKEN:
            raise RuntimeError(
                "HF_TOKEN is not set. Create a read token at huggingface.co/settings/tokens, accept the terms of "
                f"{MODEL} and pyannote/segmentation-3.0, and put the token in .env as HF_TOKEN."
            )
        pipeline = Pipeline.from_pretrained(MODEL, use_auth_token=TOKEN)
        if pipeline is None:
            raise RuntimeError(
                f"Could not load {MODEL}. Accept its terms (and those of pyannote/segmentation-3.0) while signed in "
                "to the Hugging Face account the token belongs to."
            )
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
            _state["device"] = "cuda"
        _state.update(pipeline=pipeline, status="ok", error=None)
        log.info("Loaded %s on %s", MODEL, _state["device"])
    except Exception as err:  # noqa: BLE001 - report any load failure through /health
        _state.update(status="error", error=str(err))
        log.error("Pipeline failed to load: %s", err)


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=_load_pipeline, daemon=True).start()


@app.get("/health")
def health() -> dict:
    out = {"status": _state["status"], "pipeline_loaded": _state["pipeline"] is not None, "device": _state["device"], "model": MODEL}
    if _state["error"]:
        out["error"] = _state["error"]
    return out


def _to_wav(src: str, dst: str) -> None:
    """Whatever the browser recorded (webm, ogg, m4a...) -> 16 kHz mono WAV, which is what the models read."""
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", dst],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=422, detail=f"Could not decode the audio: {proc.stderr.strip()[-300:]}")


@app.post("/v1/diarize")
def diarize(
    file: UploadFile = File(...),
    num_speakers: Optional[int] = Form(None),
    min_speakers: Optional[int] = Form(None),
    max_speakers: Optional[int] = Form(None),
) -> dict:
    if _state["status"] == "loading":
        raise HTTPException(status_code=503, detail="The diarization model is still loading; try again shortly.")
    pipeline = _state["pipeline"]
    if pipeline is None:
        raise HTTPException(status_code=503, detail=_state["error"] or "The diarization model is not available.")

    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "input")
        wav = os.path.join(tmp, "audio.wav")
        with open(src, "wb") as out:
            while chunk := file.file.read(1024 * 1024):
                out.write(chunk)
        _to_wav(src, wav)
        with _run_lock:
            annotation = pipeline(wav, **speaker_bounds(num_speakers, min_speakers, max_speakers))
        turns = annotation_to_turns(annotation)
        duration = turns[-1]["end"] if turns else 0.0
        return {"duration": duration, "speakers": speakers_in_order(turns), "turns": turns}
