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

File options:

- `max_file_size_mb`: Per-file upload limit from 1 to 25 MB.
- `max_extracted_chars`: Maximum extracted characters per file.
