# Slide Presentation Renderer

Production-ready Docker deployment for HTML-to-PowerPoint rendering using:

- **FastAPI backend** for request validation/orchestration
- **nginx frontend server** as reverse proxy/static landing page
- **Playwright renderer** with two versions:
  - `v1` (stable default)
  - `v2` (beta)

## API

### Endpoint

- `POST /api/render`
- `POST /api/v1/render` (alias)

### Authentication

- API key is required for all API requests.
- Provide it via `X-API-Key` (default header) or `Authorization: Bearer <key>`.
- API requests without a valid key return `401`.
- The backend fails startup if `API_KEYS` is empty, duplicated, too short (<16), or left as placeholder values.

### Request JSON

```json
{
  "html": "<section class='slide'>Hello</section>",
  "rendering_version": "v1",
  "input_files": [
    {
      "file_name": "image.png",
      "base64_content": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

Notes:

- `rendering_version` is optional. If omitted, `v1` is used.
- `input_files` is optional. Files are saved for the render as `/assets/<file_name>`.
- Each file object accepts either `base64_content` or `base64`.

### Response

- `200 OK`
- Body is binary `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition` includes suggested `.pptx` filename
- `X-Rendering-Version` returns the used renderer

## Run with Docker Compose

Before first start:

1. `cp .env.example .env`
2. Set a real `API_KEYS` value in `.env` (16+ chars, random)

`docker compose up` fails fast with a clear error if `API_KEYS` is missing or empty.

```bash
docker compose up -d --build
```

Service URL:

- `http://localhost:8080` (or `NGINX_PORT` from `.env`)

## Example cURL

```bash
curl -X POST "http://localhost:8080/api/render" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @request.json \
  --output presentation.pptx
```

## Security hardening included

- Request validation with strict schema and filename sanitization
- File size limits (single + total assets + HTML length)
- Temporary per-request isolated render workspace
- Playwright request guard (renderer can only load local per-request origin + data/blob/about)
- Non-root containers
- Read-only filesystem with explicit tmpfs mounts
- Linux capabilities dropped + `no-new-privileges`
- nginx rate limiting and security headers

## Configurable environment variables

See `.env.example` for defaults:

- `NGINX_PORT`
- `ENABLE_DOCS`
- `ALLOWED_HOSTS`
- `API_KEY_AUTH_ENABLED`
- `API_KEYS`
- `RENDER_TIMEOUT_SECONDS`
- `MAX_CONCURRENT_RENDERS`
- `MAX_HTML_CHARS`
- `MAX_INPUT_FILES`
- `MAX_ASSET_BYTES`
- `MAX_TOTAL_ASSET_BYTES`
