# Slide Presentation Renderer - API Reference

## 1. Overview

The Slide Presentation Renderer API converts HTML slide markup into a `.pptx` file.

- **Base URL (default):** `http://localhost:8080`
- **Primary endpoint:** `POST /api/render`
- **Alias endpoint:** `POST /api/v1/render`
- **Response type:** binary PowerPoint file

The service runs behind nginx and enforces API key authentication at **both** layers:

1. **nginx** (`auth_request` gate)
2. **FastAPI** route dependency

This dual validation prevents accidental bypass and protects the backend even if accessed directly.

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
- `GET /docs` -> **requires API key** (if docs enabled)
- `GET /openapi.json` -> **requires API key** (if docs enabled)
- `GET /healthz` -> no API key required

### 2.3 Auth-related environment variables

- `API_KEY_AUTH_ENABLED` (default: `true`)
- `API_KEYS` (comma-separated key list, each key >= 16 chars)

When auth is enabled, backend startup fails if keys are missing, duplicated, shorter than 16 chars, or still set to placeholder values.

> Key rotation is supported by setting multiple keys in `API_KEYS`, separated by commas.

---

## 3. Endpoint Reference

## 3.1 Health Check

### `GET /healthz`

Returns service liveness.

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
  "rendering_version": "v1",
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
| `rendering_version` | string enum | no | `v1` (default) or `v2` |
| `input_files` | array | no | Optional files injected into renderer workspace |

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
- `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`
- `Content-Disposition: attachment; filename="presentation_<version>_<timestamp>.pptx"`
- `X-Rendering-Version: v1|v2`
- Body: binary `.pptx`

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
- `MAX_CONCURRENT_RENDERS`
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
  --output presentation.pptx
```

## 6.2 Render using `Authorization: Bearer`

```bash
curl -X POST "http://localhost:8080/api/render" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data '{
    "html": "<section class=\"slide\">Hello</section>",
    "rendering_version": "v2"
  }' \
  --output presentation-v2.pptx
```

## 6.3 Render with external base64 request file

`request.json`:

```json
{
  "html": "<section class='slide'><img src='/assets/logo.png' /></section>",
  "rendering_version": "v1",
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
  --output presentation-with-logo.pptx
```

---

## 7. Security Notes

- Keep API keys out of source control.
- Use long random keys (32+ chars recommended).
- Rotate keys by supplying multiple values in `API_KEYS`, deploy, then remove old keys.
- Keep `ENABLE_DOCS=false` in production unless explicitly required.
