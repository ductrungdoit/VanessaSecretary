# Vanessa Secretary

Vanessa Secretary is a private AI chat interface for OpenAI-compatible APIs. It supports streamed responses, local conversation history, file analysis, responsive layouts, and deployment below the `/chatbot/` URL path.

## Features

- OpenAI-compatible `/v1/chat/completions` providers.
- Streaming responses with Markdown rendering and thinking-state cleanup.
- Separate local histories for Vincent and Dolly profiles.
- Desktop and mobile layouts with light and dark themes.
- In-memory extraction of text, source code, PDF, DOCX, XLSX, and PPTX files.
- JPEG, PNG, WebP, and GIF input for vision-capable models, selected or pasted from the clipboard.
- Retry controls for failed uploads and model responses.
- Optional Google or Brave web search integration.
- Docker image compatible with ARM64 devices such as Raspberry Pi 5.
- Application and API served below `/chatbot/` for reverse-proxy deployment.

## Requirements

- Node.js 22 or newer.
- An API key for an OpenAI-compatible model provider.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Configure at least these values in `.env`:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL=gpt-4o-mini
MODEL_FALLBACKS=gpt-4o,gemini-2.5-flash
```

Configure zero to three comma-separated fallback models. The backend tries them in order after network errors, timeouts, rate limits, server errors, or model/request incompatibility responses. Requests with images prefer `gpt-5.6-sol` when it is configured. It cannot switch after streaming has already started.

Open:

```text
http://localhost:5173/chatbot/
```

The Vite development server proxies `/chatbot/api/*` to Express on port `3000`.

## Production

```bash
npm run check
npm run build
npm start
```

Production URLs:

```text
http://localhost:3000/chatbot/
http://localhost:3000/chatbot/api/health
```

`/chatbot` redirects permanently to `/chatbot/`.

## Docker

```bash
docker build -t vanessa-secretary .
docker run --rm -p 3000:3000 --env-file .env vanessa-secretary
```

The multi-stage Dockerfile builds the frontend and runs the Express server with production dependencies only.

## File Analysis

The attachment button accepts up to five files per message. Supported formats include:

- Plain text, Markdown, CSV, JSON, XML, YAML, HTML, logs, and configuration files.
- Common source-code formats.
- PDF, DOCX, XLSX, and PPTX.

Image analysis requires the configured model and OpenAI-compatible endpoint to support vision input.

Legacy DOC, XLS, and PPT files must be converted to their newer formats first.

```env
MAX_FILE_SIZE_MB=10
MAX_EXTRACTED_CHARS=100000
```

Files are parsed in backend memory and are not written to disk. Browser history stores attachment names, not extracted content. Image-only PDF files require OCR, which is not currently included.

## Conversation History

Conversation history is stored in SQLite on the backend and synchronized across browsers that use the same Vanessa server and profile. Local development stores the database at `data/vanessa.db`; the Home Assistant add-on stores it at `/data/vanessa.db`, which persists across restarts and upgrades.

Existing browser history is imported once per profile. Attachment names are stored, but image data and extracted document contents remain in browser memory only.

## Optional Web Search

```env
SEARCH_PROVIDER=google
GOOGLE_SEARCH_API_KEY=your_google_custom_search_api_key
GOOGLE_SEARCH_ENGINE_ID=your_programmable_search_engine_id
BRAVE_SEARCH_API_KEY=your_brave_search_api_key
SEARCH_RESULT_LIMIT=8
SEARCH_TIMEOUT_MS=10000
```

Google is used first when selected. Brave can act as a fallback. Leave the credentials unset to run without web search.

## Home Assistant OS Add-on

This repository is a Home Assistant add-on repository. On Home Assistant OS:

1. Open **Settings > Add-ons > Add-on Store**.
2. Open the repository menu and select **Repositories**.
3. Add `https://github.com/ductrungdoit/VanessaSecretary`.
4. Install **Vanessa Secretary**.
5. Set `openai_api_key`, `openai_base_url`, and `model` in the Configuration tab.
6. Start the add-on and verify `http://HOME_ASSISTANT_IP:3000/chatbot/api/health`.

The repository publishes separate `aarch64` and `amd64` images to GitHub Container Registry. Raspberry Pi 5 uses the `aarch64` image. A GitHub Actions workflow publishes the add-on version and `latest` tags after relevant changes reach `main`.

If Home Assistant cannot pull the image, verify that the `vanessa-secretary-aarch64` package is public in the repository package settings.

The target public URL through Cloudflare Tunnel is:

```text
https://domain.com/chatbot/
```

The application-side base path, health endpoint, add-on metadata, and ARM64 image workflow are included. Cloudflare Tunnel routing and Cloudflare Access are the next deployment steps.

## Security

- Never commit `.env` or API keys.
- Keep model credentials on the backend.
- Protect public deployments with Cloudflare Access or equivalent authentication.
- Bypass Cloudflare caching for `/chatbot/api/*`, especially the streaming chat endpoint.
- Do not expose Raspberry Pi ports directly to the internet when Cloudflare Tunnel is available.
- Rotate credentials if they have appeared in logs or terminal output.

## Environment Variables

See [`.env.example`](.env.example) for all supported settings.
