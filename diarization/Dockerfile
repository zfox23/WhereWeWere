# Speaker diarization (pyannote.audio 3.1) behind a tiny HTTP API. Optional: started only with
#   docker compose --profile diarization up -d
# Needs an NVIDIA GPU for speed (it runs on CPU, slowly) and a Hugging Face token; see docs/audio-notes.md.
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "pyannote.audio==3.3.2" fastapi "uvicorn[standard]" python-multipart

WORKDIR /app
COPY turns.py server.py /app/

# Models download here on first start; the compose file mounts a volume so it happens once.
ENV HF_HOME=/models
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
    CMD curl -sf http://127.0.0.1:8001/health >/dev/null || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
