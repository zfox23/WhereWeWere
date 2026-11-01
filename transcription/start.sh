#!/bin/sh
# Start Speaches (faster-whisper behind an OpenAI-compatible API), then make
# sure the model named by TRANSCRIPTION_MODEL is installed. Speaches ships with
# no models and does not fetch one on first use, so without this every
# transcription request would fail with "model is not installed locally".
#
#   TRANSCRIPTION_MODEL  Hugging Face model id, e.g. Systran/faster-whisper-large-v3.
#                        Set it empty to skip installing anything.
#   TRANSCRIPTION_PORT   not used here: the port inside the container is always 8000.
#
# The download happens once; the model lives in the mounted Hugging Face cache
# (the whisper_models volume), so later starts only check that it is there.

PORT=8000
BASE="http://127.0.0.1:${PORT}"
MODEL="${TRANSCRIPTION_MODEL-}"

uvicorn --factory speaches.main:create_app --host 0.0.0.0 --port "$PORT" &
server=$!
# Forward a stop request so `docker compose down` doesn't wait for the kill timeout.
trap 'kill -TERM "$server" 2>/dev/null' TERM INT

if [ -n "$MODEL" ]; then
  (
    until curl -sf "$BASE/health" >/dev/null 2>&1; do sleep 1; done
    if curl -sf "$BASE/v1/models/$MODEL" >/dev/null 2>&1; then
      echo "[transcription] model $MODEL is installed"
      exit 0
    fi
    echo "[transcription] installing model $MODEL (the first start downloads it; this can take several minutes)..."
    attempt=1
    while [ "$attempt" -le 5 ]; do
      if curl -sS -f -X POST "$BASE/v1/models/$MODEL" >/dev/null; then
        echo "[transcription] model $MODEL installed"
        exit 0
      fi
      echo "[transcription] installing $MODEL failed (attempt $attempt of 5); retrying in 15s" >&2
      attempt=$((attempt + 1))
      sleep 15
    done
    echo "[transcription] could not install $MODEL. Check the model name and the container's internet access." >&2
  ) &
fi

# Keep the container tied to the server's lifetime; wait again after a trapped signal to reap it.
wait "$server"
status=$?
wait "$server" 2>/dev/null
exit "$status"
