# Slide Presentation Renderer - API Reference

## 1. Overview

The Slide Presentation Renderer API converts HTML slide markup into a `.pptx` file.

- **Base URL (default):** `http://localhost:8080`
- **Primary endpoint:** `POST /api/render`
- **Alias endpoint:** `POST /api/v1/render`
- **Response type:** ZIP bundle (`.zip`) containing the rendered PowerPoint and slide PNG previews

The render API runs behind nginx and enforces API key authentication at **both** layers:

1. **nginx** (`auth_request` gate)
2. **FastAPI** route dependency

This dual validation prevents accidental bypass and protects render endpoints even if accessed directly.

---

## 2. Authentication

### 2.1 Supported auth methods

Send one of the following headers:

1. `X-API-Key: <your-key>` (default)
2. `Authorization: Bearer <your-key>`

If neither is valid, the API returns:

- `401 Unauthorized`
- JSON body: `{"detail":"invalid or missing API key"}`

### 2.2 Auth behavior by route

- `POST /api/render` -> **requires API key**
- `POST /api/v1/render` -> **requires API key**
- `GET /docs` -> no API key required (when docs are enabled)
- `GET /openapi.json` -> no API key required (when docs are enabled)
- `GET /healthz` -> no API key required

### 2.3 Environment variables (auth + docs)

- `DEVELOPMENT_MODE` (default: `false`)
- `ENABLE_DOCS` (default: `false`; controls whether `/docs` and `/openapi.json` are exposed)
- `ENVIRONMENT` (default: `development`; set to `production` to enforce production guardrails)
- `ALLOW_INSECURE_PRODUCTION_CONFIGURATION` (default: `false`; bypasses production guardrails)
- `API_KEY_AUTH_ENABLED` (default: `true`)
- `API_KEYS` (comma-separated key list, each key >= 16 chars)

`DEVELOPMENT_MODE` takes precedence over `ENABLE_DOCS`: if `DEVELOPMENT_MODE=true`, docs endpoints are enabled even when `ENABLE_DOCS=false`.

**WARNING:** `DEVELOPMENT_MODE` must never be `true` in production.

Accepted boolean values follow the backend parser behavior:

- `true` values: `1`, `true`, `yes`, `on` (case-insensitive)
- any other value (or unset): treated as `false`

When `ENVIRONMENT=production`, the service fails startup unless:

- `DEVELOPMENT_MODE=false`
- `ENABLE_DOCS=false`
- `API_KEY_AUTH_ENABLED=true`
- `ALLOWED_HOSTS` does not contain `*`

`ALLOW_INSECURE_PRODUCTION_CONFIGURATION=true` bypasses those checks, but should only be used intentionally.

When auth is enabled, backend startup fails if keys are missing, duplicated, shorter than 16 chars, or still set to placeholder values.

> Key rotation is supported by setting multiple keys in `API_KEYS`, separated by commas.

---

## 3. Endpoint Reference

## 3.1 Health Check

### `GET /healthz`

Returns backward-compatible readiness.

### `GET /livez`

Returns process liveness.

### `GET /readyz`

Returns full service readiness, including config, auth, and renderer dependency checks.

**Response**

- `200 OK`
- JSON:

```json
{"status":"ok"}
```

---

## 3.2 Render Presentation (default)

### `POST /api/render`

Converts HTML slides into PowerPoint.

### `POST /api/v1/render`

Alias of `/api/render` with the same behavior.

### Request headers

- `Content-Type: application/json`
- `X-API-Key: <key>` **or** `Authorization: Bearer <key>`

### Request body

```json
{
  "html": "<section class='slide'>Hello</section>",
  "input_files": [
    {
      "file_name": "logo.png",
      "base64_content": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

### Body fields

| Field | Type | Required | Description |
|---|---|---|---|
| `html` | string | yes | Full HTML document/fragment containing renderable slides |
| `input_files` | array | no | Optional files injected into renderer workspace |

The renderer always uses the stable `v1` pipeline. Client requests must not
include a `rendering_version` field.

#### `input_files[]` object

| Field | Type | Required | Description |
|---|---|---|---|
| `file_name` | string | yes | Asset file name; only `[A-Za-z0-9._-]`, no path separators |
| `base64_content` | string | yes* | Base64 file contents |
| `base64` | string | yes* | Alias of `base64_content` |

`*` The API accepts either `base64_content` or `base64`.

### Asset resolution inside render

Each `input_files` entry is written to:

- `/assets/<file_name>`

Your HTML can reference those files directly, e.g.:

```html
<img src="/assets/logo.png" />
```

### Success response

- `200 OK`
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="presentation_<version>_<timestamp>.zip"`
- `X-Rendering-Version: v1`
- `X-Slide-Count: <number of generated slide PNG files>`
- Body: binary `.zip` with structure:
  - `presentation_<version>_<timestamp>.pptx`
  - `slides/slide_001.png`
  - `slides/slide_002.png`
  - ...

---

## 4. Error Model

Validation and operational failures return JSON:

```json
{
  "detail": "..."
}
```

### Common status codes

| Status | Meaning |
|---|---|
| `400` | Invalid request data (schema, base64, duplicate filenames, limits) |
| `401` | Missing/invalid API key |
| `405` | Method not allowed (only POST/OPTIONS for `/api/*`) |
| `429` | Renderer currently saturated; retry later |
| `500` | Internal rendering failure |
| `504` | Render timeout exceeded |

---

## 5. Limits and Operational Constraints

Configured via environment variables:

- `RENDER_TIMEOUT_SECONDS`
- `RENDER_QUEUE_TIMEOUT_MS`
- `MAX_CONCURRENT_RENDERS`
- `MAX_REQUEST_BODY_BYTES`
- `MAX_HTML_CHARS`
- `MAX_INPUT_FILES`
- `MAX_ASSET_BYTES`
- `MAX_TOTAL_ASSET_BYTES`

### Current default behavior

- Concurrent renders are capped; overflow requests get `429`.
- Each request is processed in an isolated temporary workspace.
- Renderer network access is constrained to the local request origin (plus data/blob/about URLs).

---

## 6. Examples

## 6.1 Basic render with `X-API-Key`

```bash
curl -X POST "http://localhost:8080/api/render" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{
    "html": "<section class=\"slide\">Hello</section>"
  }' \
  --output presentation.zip
```

## 6.2 Render using `Authorization: Bearer`

```bash
curl -X POST "http://localhost:8080/api/render" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{
    "html": "<section class=\"slide\">Hello</section>"
  }' \
  --output presentation.zip
```

## 6.3 Render with external base64 request file

`request.json`:

```json
{
  "html": "<section class='slide'><img src='/assets/logo.png' /></section>",
  "input_files": [
    {
      "file_name": "logo.png",
      "base64_content": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}
```

Call:

```bash
curl -X POST "http://localhost:8080/api/render" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @request.json \
  --output presentation-with-logo.zip
```

---

## 7. Security Notes

- Keep API keys out of source control.
- Use long random keys (32+ chars recommended).
- Rotate keys by supplying multiple values in `API_KEYS`, deploy, then remove old keys.
- Keep `ENABLE_DOCS=false` in production unless explicitly required.
