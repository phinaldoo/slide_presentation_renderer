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
- The backend also fails startup if production guardrails are violated, unless explicitly overridden.

WARNING: exposing `/docs` and `/openapi.json` without authentication is unsafe for production.

- Docs endpoints must only be enabled in non-production environments.
- `ENABLE_DOCS` controls docs exposure in normal operation.
- `DEVELOPMENT_MODE` overrides `ENABLE_DOCS`; if `DEVELOPMENT_MODE=true`, docs endpoints are exposed even when `ENABLE_DOCS=false`.
- `ENVIRONMENT=production` enforces production guardrails:
  - `DEVELOPMENT_MODE` must be `false`
  - `ENABLE_DOCS` must be `false`
  - `API_KEY_AUTH_ENABLED` must be `true`
  - `ALLOWED_HOSTS` must not contain `*`
- `ALLOW_INSECURE_PRODUCTION_CONFIGURATION=true` bypasses those guardrails, but should only be used deliberately.

### Request JSON

```json
{
  "html": "<section class='slide'>Hello</section>",
  "input_files": [
    {
      "file_name": "image.png",
      "base64_content": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

Notes:

- The renderer version is selected by the server. Set `BETA=true` in the renderer environment to use `v2`; leave it false for `v1`.
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

`docker compose up` fails fast with a clear error if required runtime safeguards are invalid, including missing `API_KEYS`.

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
- Explicit request body size enforcement with `413` protection
- Temporary per-request isolated render workspace
- Playwright request guard (renderer can only load local per-request origin + data/blob/about)
- Startup/readiness validation for auth, config, writable temp storage, Playwright Chromium, and v2 Node dependencies
- Non-root containers
- Read-only filesystem with explicit tmpfs mounts
- Linux capabilities dropped + `no-new-privileges`
- Docker log rotation
- nginx rate limiting, connection limiting, and security headers
- nginx body-size and upstream timeout settings derived from the same env vars as the backend

## Configurable environment variables

See `.env.example` for defaults:

- `NGINX_PORT`
- `ENVIRONMENT`
- `DEVELOPMENT_MODE`
- `ENABLE_DOCS`
- `BETA`
- `ALLOW_INSECURE_PRODUCTION_CONFIGURATION`
- `ALLOWED_HOSTS`
- `API_KEY_AUTH_ENABLED`
- `API_KEYS`
- `RENDER_TIMEOUT_SECONDS`
- `RENDER_QUEUE_TIMEOUT_MS`
- `PAGE_LOAD_TIMEOUT_MS`
- `MAX_CONCURRENT_RENDERS`
- `MAX_REQUEST_BODY_BYTES`
- `MAX_HTML_CHARS`
- `MAX_INPUT_FILES`
- `MAX_ASSET_BYTES`
- `MAX_TOTAL_ASSET_BYTES`

WARNING: keep docs disabled in production.

- `ENABLE_DOCS` should be `false` in production.
- `DEVELOPMENT_MODE` must be `false` in production.
- Explicit override behavior: `DEVELOPMENT_MODE=true` enables `/docs` and `/openapi.json` even when `ENABLE_DOCS=false`.
- `ALLOWED_HOSTS` should be a concrete hostname allowlist in production.
- `ALLOW_INSECURE_PRODUCTION_CONFIGURATION` should remain `false` in production.

## Health endpoints

- `GET /livez`: nginx/backend process liveness
- `GET /readyz`: full service readiness, including runtime/config checks
- `GET /healthz`: backward-compatible alias for `/readyz`

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

- Set `ENVIRONMENT=production` in production deployments.
- Set `DEVELOPMENT_MODE=false` in production.
- Set `ENABLE_DOCS=false` in production unless there is an approved exception.
- Keep `ALLOW_INSECURE_PRODUCTION_CONFIGURATION=false`.
- Set a concrete `ALLOWED_HOSTS` allowlist.
- Verify effective runtime values at deploy time (container env, Compose overrides, Helm values, CI/CD variables).
