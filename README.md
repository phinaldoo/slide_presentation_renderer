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
- `/docs` and `/openapi.json` are intentionally excluded from API key protection for browser access when docs are enabled.
- The backend fails startup if `API_KEYS` is empty, duplicated, too short (<16), or left as placeholder values.

WARNING: exposing `/docs` and `/openapi.json` without authentication is unsafe for production.

- Docs endpoints must only be enabled in non-production environments.
- `ENABLE_DOCS` controls docs exposure in normal operation.
- `DEVELOPMENT_MODE` overrides `ENABLE_DOCS`; if `DEVELOPMENT_MODE=true`, docs endpoints are exposed even when `ENABLE_DOCS=false`.
- There is no built-in environment detector that automatically blocks this in production; use deployment guardrails (below) to prevent accidental enablement.

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
- Body is binary `application/zip`
- `Content-Disposition` includes suggested `.zip` filename
- `X-Rendering-Version` returns the used renderer
- `X-Slide-Count` returns number of generated slide PNG files

ZIP structure:

- `presentation_<version>_<timestamp>.pptx`
- `slides/slide_001.png`
- `slides/slide_002.png`
- ...

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
  --output presentation_bundle.zip
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
- `DEVELOPMENT_MODE`
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

WARNING: keep docs disabled in production.

- `ENABLE_DOCS` should be `false` in production.
- `DEVELOPMENT_MODE` must be `false` in production.
- Explicit override behavior: `DEVELOPMENT_MODE=true` enables `/docs` and `/openapi.json` even when `ENABLE_DOCS=false`.

## Docs exposure security trade-offs

Enabling docs endpoints improves developer UX, but it also increases information disclosure risk:

- Exposes your API surface area and available endpoints.
- Exposes request/response schemas and field names.
- Makes endpoint discovery and probing easier for attackers.

Recommended mitigations when docs are needed:

- Restrict docs access by source IP (VPN/corporate CIDR allowlist).
- Protect docs with authentication at the proxy or gateway layer.
- Feature-flag docs and only enable them temporarily for specific environments.

## Deployment checklist

- Set `DEVELOPMENT_MODE=false` in production.
- Set `ENABLE_DOCS=false` in production unless there is an approved exception.
- Add a startup validation routine (for example, `validateEnv` or `startup_checks`) that warns or fails startup if `DEVELOPMENT_MODE=true` is detected in production.
- Verify effective runtime values at deploy time (container env, Compose overrides, Helm values, CI/CD variables).
