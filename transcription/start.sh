#!/bin/sh
# Start whisper.cpp's server behind an OpenAI-compatible endpoint
# (POST /v1/audio/transcriptions), downloading the model on the first start.
#
#   TRANSCRIPTION_MODEL  whisper.cpp model name, e.g. large-v3 (file ggml-large-v3.bin from
#                        huggingface.co/ggerganov/whisper.cpp). Downloaded once into /models
#                        (the whisper_cpp_models volume); later starts only check it is there.
#   TRANSCRIPTION_PORT   not used here: the port inside the container is always 8000.
#
# Why whisper.cpp: it can be told not to feed each 30 s window the text of the one before
# (--max-context 0), and it keeps the temperature fallback that re-decodes a repetitive window.
# Speaches did neither, so one bad window ("Yeah.") repeated to the end of a recording.

set -eu

MODEL="${TRANSCRIPTION_MODEL:-large-v3}"
case "$MODEL" in
  */*)
    # A Hugging Face id from the Speaches days (e.g. Systran/faster-whisper-large-v3).
    echo "[transcription] TRANSCRIPTION_MODEL=$MODEL is not a whisper.cpp model name; using large-v3. Set it to e.g. large-v3." >&2
    MODEL=large-v3
    ;;
esac
FILE="/models/ggml-${MODEL}.bin"
URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin"

if [ ! -s "$FILE" ]; then
  echo "[transcription] downloading model $MODEL (about 3 GB for large-v3; once only)..."
  attempt=1
  until curl -fL --retry 3 -o "$FILE.part" "$URL"; do
    if [ "$attempt" -ge 5 ]; then
      echo "[transcription] could not download $URL. Check TRANSCRIPTION_MODEL and the container's internet access." >&2
      exit 1
    fi
    echo "[transcription] download failed (attempt $attempt of 5); retrying in 15s" >&2
    attempt=$((attempt + 1))
    sleep 15
  done
  mv "$FILE.part" "$FILE"
fi
echo "[transcription] using $FILE"

# --request-path/--inference-path: answer at /v1/audio/transcriptions, where the app sends audio.
# --convert: decode whatever the browser recorded (webm, ogg, m4a...) with ffmpeg.
# --language auto: detect the language.
# --max-context 0: no previous text as a prompt, so one repetitive window can't seed the next.
exec /app/build/bin/whisper-server \
  --model "$FILE" \
  --host 0.0.0.0 --port 8000 \
  --request-path /v1 --inference-path /audio/transcriptions \
  --convert --tmp-dir /tmp \
  --language auto \
  --max-context 0
