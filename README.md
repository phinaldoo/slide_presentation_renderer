# Slide Presentation Renderer

Slide Presentation Renderer is a sub-service of the ChatUI project. It is a Docker deployment for HTML-to-PowerPoint rendering. This is used for agentic slide creation and editing. 

Technical details:
- **FastAPI backend** for request validation/orchestration
- **nginx reverse proxy**
- **Playwright renderer**

Why is this a separate service and not part of the main ChatUI service?

- The renderer is based on Playwright, which is a heavy dependency.
- For performance reasons, it is better to run the renderer in a separate container and scale it independently.


## Setup

These instructions are for macOS, Linux, and Windows.

### Prerequisites

- Docker
  - macOS: install Docker Desktop.
  - Linux: install Docker Engine.
  - Windows: install Docker Desktop with WSL 2 enabled.
- Docker Compose v2, available as the `docker compose` command.
- `make`, optional but recommended for the shortest commands.
- Python 3, only needed when using the Bash setup path. The Windows PowerShell setup path does not require Python.

Check that the required tools are available:

macOS/Linux or Windows with WSL/Git Bash:

```bash
docker --version
docker compose version
python3 --version  # or: python --version
```

If you want to use the Makefile path, also check:

```bash
make --version
```

Windows PowerShell:

```powershell
docker --version
docker compose version
```

### Option 1: macOS/Linux/Windows with Makefile

Use this path if `make` is installed. On macOS/Linux, `make setup` uses `setup.sh`; on Windows, it uses `setup.ps1`.

```bash
# Prepare .env, create ./certs, and generate API_KEYS if needed
make setup

# Build and start the renderer stack in the background
make up

# Check container status
make ps

# Follow logs
make logs
```

The service is available at:

- `http://localhost:8080`
- `http://localhost:8080/readyz`

Useful Makefile commands:

```bash
make up       # Build and start the stack
make down     # Stop and remove containers
make restart  # Restart all services
make logs     # Follow logs
make ps       # Show container status
```

### Option 2: macOS/Linux without Makefile

Use this path if you do not have `make` installed or prefer plain shell commands.

```bash
# Prepare .env, create ./certs, and generate API_KEYS if needed
bash ./setup.sh

# Build and start the renderer stack in the background
docker compose -f docker-compose.yml up -d --build

# Check container status
docker compose -f docker-compose.yml ps

# Follow logs
docker compose -f docker-compose.yml logs -f
```

The service is available at:

- `http://localhost:8080`
- `http://localhost:8080/readyz`

Useful Docker Compose commands:

```bash
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml down
docker compose -f docker-compose.yml restart
docker compose -f docker-compose.yml logs -f
docker compose -f docker-compose.yml ps
```

### Option 3: Windows PowerShell without Makefile

Use this path for native Windows setup.

```powershell
# Prepare .env, create .\certs, and generate API_KEYS if needed
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# Build and start the renderer stack in the background
docker compose -f docker-compose.yml up -d --build

# Check container status
docker compose -f docker-compose.yml ps

# Follow logs
docker compose -f docker-compose.yml logs -f
```

The service is available at:

- `http://localhost:8080`
- `http://localhost:8080/readyz`

Useful Docker Compose commands:

```powershell
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml down
docker compose -f docker-compose.yml restart
docker compose -f docker-compose.yml logs -f
docker compose -f docker-compose.yml ps
```

### What Setup Creates

`make setup`, `bash ./setup.sh`, and `powershell -ExecutionPolicy Bypass -File .\setup.ps1` do the same preparation:

- Create `.env` from `.env.example` if it does not exist.
- Add any new keys from `.env.example` into an existing `.env`.
- Create the `./certs/` directory.
- Generate a secure `API_KEYS` value when one is missing or unsafe.

After setup, review `.env` if you want to change the port, HTTPS settings, docs exposure, or production hardening.

### Changing the Port

By default, nginx listens on `8080`. To use another port, edit `.env`:

```bash
NGINX_PORT=8090
```

Then restart the stack:

```bash
make restart
```

Without Makefile:

```bash
docker compose -f docker-compose.yml restart
```

Windows PowerShell:

```powershell
docker compose -f docker-compose.yml restart
```

### Testing a Render Request

Create a small request file:

macOS/Linux or Windows with WSL/Git Bash:

```bash
cat > request.json <<'JSON'
{
  "html": "<section class='slide'><h1>Hello from the renderer</h1></section>"
}
JSON
```

Windows PowerShell:

```powershell
@'
{
  "html": "<section class='slide'><h1>Hello from the renderer</h1></section>"
}
'@ | Set-Content -Path request.json
```

Send it to the service. Use the first key from `.env` as the API key.

macOS/Linux or Windows with WSL/Git Bash:

```bash
API_KEY="$(grep '^API_KEYS=' .env | cut -d= -f2 | cut -d, -f1)"

curl -X POST "http://localhost:8080/api/render" \
  -H "X-API-Key: ${API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @request.json \
  --output presentation_bundle.zip
```

Windows PowerShell:

```powershell
$ApiKey = ((Select-String -Path .env -Pattern '^API_KEYS=').Line -replace '^API_KEYS=', '').Split(',')[0]

curl.exe -X POST "http://localhost:8080/api/render" `
  -H "X-API-Key: $ApiKey" `
  -H "Content-Type: application/json" `
  --data-binary "@request.json" `
  --output presentation_bundle.zip
```

If the request succeeds, `presentation_bundle.zip` contains the generated PowerPoint file and slide images.

## Security

### Vulnerability Disclosure

Please see [SECURITY.md](./SECURITY.md) for details on how to report security vulnerabilities.

## API Documentation

### Endpoint

- `GET /`
- `GET /version`
- `POST /api/render`

### Authentication

- API key is required for render requests.
- Provide it via `X-API-Key` (default header) or `Authorization: Bearer <key>`.
- Render requests without a valid key return `401`.
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

- The renderer always uses the stable `v1` pipeline.
- `input_files` is optional. Files are saved for the render as `/assets/<file_name>`.
- Each file object must use `base64_content`.

### Response

- `200 OK`
- Body is binary `application/zip`
- `Content-Disposition` includes suggested `.zip` filename
- `X-Rendering-Version` returns the used renderer
- `X-Renderer-Version` returns the renderer app version
- `X-Renderer-Version-Tag` returns the renderer app version tag
- `X-Slide-Count` returns number of generated slide PNG files

ZIP structure:

- `presentation_<version>_<timestamp>.pptx`
- `slides/slide_001.png`
- `slides/slide_002.png`
- ...

## HTTPS

- Put your certificate files in `./certs/`.
- The default expected filenames are `./certs/fullchain.pem` and `./certs/privkey.pem`.
- Set `FRONTEND_USE_HTTPS=true` in `.env` to serve HTTPS on `NGINX_PORT`.
- The nginx container reads those files at `/certs/fullchain.pem` and `/certs/privkey.pem`.

## Security hardening included

- Request validation with strict schema and filename sanitization
- File size limits (single + total assets + HTML length)
- Explicit request body size enforcement with `413` protection
- Temporary per-request isolated render workspace
- Playwright request guard (renderer can only load local per-request origin + data/blob/about)
- Startup/readiness validation for auth, config, writable temp storage, and Playwright Chromium
- Non-root containers
- Read-only filesystem with explicit tmpfs mounts
- Linux capabilities dropped + `no-new-privileges`
- Docker log rotation
- nginx rate limiting, connection limiting, and security headers
- nginx body-size and upstream timeout settings derived from the same env vars as the backend

## Configurable environment variables

See `.env.example` for defaults:

- `NGINX_PORT`
- `FRONTEND_USE_HTTPS`
- `FRONTEND_SSL_CERT_PATH`
- `FRONTEND_SSL_KEY_PATH`
- `FRONTEND_SSL_CHAIN_PATH`
- `ENVIRONMENT`
- `DEVELOPMENT_MODE`
- `ENABLE_DOCS`
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
