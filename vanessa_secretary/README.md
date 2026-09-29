# Vanessa Secretary Home Assistant Add-on

This add-on runs Vanessa Secretary on Home Assistant OS. After installation, configure the model provider in the add-on Configuration tab and open:

```text
http://HOME_ASSISTANT_IP:3000/chatbot/
```

The port is intended for LAN access or as the origin of a Cloudflare Tunnel. Do not forward it directly from the router to the internet.

Required option:

- `openai_api_key`: API key for the OpenAI-compatible provider.

Provider options:

- `openai_base_url`: API base URL ending in `/v1`.
- `model`: Provider model identifier.
- `system_prompt`: System instruction sent before conversations.
- `fallback_model_1`, `fallback_model_2`, and `fallback_model_3`: Optional models tried in order when the primary model fails before streaming starts. Requests containing images prefer `gpt-5.6-sol` when configured.

Conversation history is stored in `/data/vanessa.db` and synchronized between devices using the same add-on and profile. The `/data` directory persists across add-on restarts and upgrades.

Optional search options:

- `search_provider`: `google` or `brave`.
- `google_search_api_key` and `google_search_engine_id`: Google Programmable Search credentials.
- `brave_search_api_key`: Brave Search fallback credential.
- `search_result_limit` and `search_timeout_ms`: Search limits.

The Configuration tab expects YAML keys, not `.env` assignments. Example:

```yaml
openai_api_key: your_new_api_key
openai_base_url: https://llm.mrdnd.dev/v1
model: MiniMax-M3
system_prompt: ""
search_provider: google
google_search_api_key: your_new_google_key
google_search_engine_id: your_engine_id
brave_search_api_key: ""
search_result_limit: 8
search_timeout_ms: 10000
max_file_size_mb: 10
max_extracted_chars: 100000
```

File options:

- `max_file_size_mb`: Per-file upload limit from 1 to 25 MB.
- `max_extracted_chars`: Maximum extracted characters per file.

JPEG, PNG, WebP, and GIF images can be selected or pasted from the clipboard. Image analysis requires a vision-capable model at the configured provider.
