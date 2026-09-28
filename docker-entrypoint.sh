#!/bin/sh
set -eu

OPTIONS_FILE=/data/options.json

if [ -f "$OPTIONS_FILE" ]; then
  export OPENAI_API_KEY="$(jq -r '.openai_api_key // empty' "$OPTIONS_FILE")"
  export OPENAI_BASE_URL="$(jq -r '.openai_base_url // "https://api.openai.com/v1"' "$OPTIONS_FILE")"
  export MODEL="$(jq -r '.model // "gpt-4o-mini"' "$OPTIONS_FILE")"
  export SYSTEM_PROMPT="$(jq -r '.system_prompt // "You are a helpful, accurate, and concise AI assistant."' "$OPTIONS_FILE")"
  export MAX_FILE_SIZE_MB="$(jq -r '.max_file_size_mb // 10' "$OPTIONS_FILE")"
  export MAX_EXTRACTED_CHARS="$(jq -r '.max_extracted_chars // 100000' "$OPTIONS_FILE")"
fi

exec node server.js
