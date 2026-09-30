#!/bin/sh
set -eu

OPTIONS_FILE=/data/options.json

if [ -f "$OPTIONS_FILE" ]; then
  export OPENAI_API_KEY="$(jq -r '.openai_api_key // empty' "$OPTIONS_FILE")"
  export OPENAI_BASE_URL="$(jq -r '.openai_base_url // "https://api.openai.com/v1"' "$OPTIONS_FILE")"
  export MODEL="$(jq -r '.model // "gpt-4o-mini"' "$OPTIONS_FILE")"
  export MODEL_FALLBACKS="$(jq -r '[.fallback_model_1, .fallback_model_2, .fallback_model_3] | map(select(. != null and . != "")) | join(",")' "$OPTIONS_FILE")"
  export ACCESS_PASSWORD="$(jq -r '.access_password // empty' "$OPTIONS_FILE")"
  export ALLOW_INSECURE_HTTP="$(jq -r '.allow_insecure_http // false' "$OPTIONS_FILE")"
  export SYSTEM_PROMPT="$(jq -r '.system_prompt // "You are a helpful, accurate, and concise AI assistant."' "$OPTIONS_FILE")"
  export SEARCH_PROVIDER="$(jq -r '.search_provider // "google"' "$OPTIONS_FILE")"
  export GOOGLE_SEARCH_API_KEY="$(jq -r '.google_search_api_key // empty' "$OPTIONS_FILE")"
  export GOOGLE_SEARCH_ENGINE_ID="$(jq -r '.google_search_engine_id // empty' "$OPTIONS_FILE")"
  export BRAVE_SEARCH_API_KEY="$(jq -r '.brave_search_api_key // empty' "$OPTIONS_FILE")"
  export SEARCH_RESULT_LIMIT="$(jq -r '.search_result_limit // 8' "$OPTIONS_FILE")"
  export SEARCH_TIMEOUT_MS="$(jq -r '.search_timeout_ms // 10000' "$OPTIONS_FILE")"
  export MAX_FILE_SIZE_MB="$(jq -r '.max_file_size_mb // 10' "$OPTIONS_FILE")"
  export MAX_EXTRACTED_CHARS="$(jq -r '.max_extracted_chars // 100000' "$OPTIONS_FILE")"
fi

export DATA_DIR=/data

exec node server.js
