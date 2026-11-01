# Speaker diarization (pyannote.audio 3.1) behind a tiny HTTP API. Optional: started only with
#   docker compose --profile diarization up -d --build diarization
# Needs an NVIDIA GPU for speed (it runs on CPU, slowly) and a Hugging Face token; see docs/audio-notes.md.
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Fail the build, not the running service, if the packages do not fit together: the torch stack must
# still be the base image's, and everything pyannote needs must import.
RUN python - <<'PY'
import torch, torchvision, torchaudio, numpy
assert torch.__version__.startswith("2.4.1"), f"torch drifted to {torch.__version__}"
assert torchvision.__version__.startswith("0.19.1"), f"torchvision is {torchvision.__version__}"
assert torchaudio.__version__.startswith("2.4.1"), f"torchaudio drifted to {torchaudio.__version__}"
assert numpy.__version__.startswith("1."), f"numpy is {numpy.__version__}"
from pyannote.audio import Pipeline  # noqa: F401  (imports torchvision, lightning, speechbrain...)
print("ok:", torch.__version__, torchvision.__version__, torchaudio.__version__, numpy.__version__)
PY

WORKDIR /app
COPY turns.py server.py /app/

# Models download here on first start; the compose file mounts a volume so it happens once.
ENV HF_HOME=/models
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
    CMD curl -sf http://127.0.0.1:8001/health >/dev/null || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
