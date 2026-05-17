# Slide Presentation Renderer

Slide Presentation Renderer is a sub-service of the ChatUI project. It is a Docker deployment for HTML-to-PowerPoint rendering. This is used for agentic slide creation and editing. 

Technical details:
- **FastAPI backend** for request validation/orchestration
- **nginx reverse proxy**
- **Playwright renderer**

**Note:** Currently it only supports rendering to uneditable PowerPoint files. In the near future, it will support rendering to editable PowerPoint files.

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
# Prepare .env and generate API_KEYS if needed
make setup

# Build and start the renderer stack in the background
make up
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
# Prepare .env and generate API_KEYS if needed
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
# Prepare .env and generate API_KEYS if needed
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

## Security

### Public Exposure Checklist

Do not expose this service to the internet or a shared network until all of the following are true:

- `API_KEY_AUTH_ENABLED=true` and `API_KEYS` contains fresh, long, random secrets created for this deployment.
- Traffic is protected by TLS, either with `FRONTEND_USE_HTTPS=true` or by placing the service behind a TLS-terminating reverse proxy/load balancer.
- `ALLOWED_HOSTS` is restricted to the real hostname or hostnames that should serve this instance. Do not use `ALLOWED_HOSTS=*` outside local development.
- `DEVELOPMENT_MODE=false`, `ENABLE_DOCS=false`, and `ALLOW_INSECURE_PRODUCTION_CONFIGURATION=false`.
- Real secrets and certificate private keys are stored outside source control and rotated if they were ever shared, logged, or used in another environment.

If you publish a self-hosted instance, treat every render request as untrusted code execution inside Chromium. Uploaded HTML can run JavaScript while it is rendered. The renderer blocks non-local browser requests during rendering and the Docker Compose stack applies resource limits, but public instances still need operational protections:

- Keep nginx or an upstream reverse proxy rate limits enabled and tune them for your expected users.
- Keep strict CPU, memory, process, request-size, slide-count, asset-size, timeout, and output-size limits.
- Monitor logs, health checks, render latency, error rates, `429` responses, and container restarts.
- Prefer outbound network restrictions at the host, firewall, or orchestrator layer so the renderer container cannot reach internal services or the public internet except where deliberately required.

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

- The `./certs/` directory is included in the repository for optional HTTPS certificate files.
- Put your certificate files in `./certs/`.
- The default expected filenames are `./certs/fullchain.pem` and `./certs/privkey.pem`.
- Set `FRONTEND_USE_HTTPS=true` in `.env` to serve HTTPS on `NGINX_PORT`.
- The nginx container reads those files at `/certs/fullchain.pem` and `/certs/privkey.pem`.

## Configurable environment variables

See `.env.example` for the source defaults. `setup.sh` and `setup.ps1` create `.env` from that file and generate `API_KEYS` when needed.

| Variable | Default | Description | Best practices |
| --- | --- | --- | --- |
| `ENVIRONMENT` | `development` | Deployment environment name. Production guardrails are enforced when this is `production` or `prod`. | Use `development` locally, `staging` for pre-production, and `production` for live deployments. |
| `NGINX_PORT` | `8080` | Public host port exposed by the nginx reverse proxy. | Keep `8080` locally unless it conflicts. In production, put the service behind a reverse proxy or load balancer and expose only the required TLS-protected port. |
| `FRONTEND_USE_HTTPS` | `false` | Enables HTTPS in the nginx container using certificate files mounted from `./certs`. | Keep `false` locally unless you need HTTPS testing. Use `true` in production when nginx terminates TLS, or terminate TLS at an upstream reverse proxy/load balancer. |
| `FRONTEND_SSL_CERT_PATH` | `/certs/fullchain.pem` | Certificate file path inside the nginx container. | Keep the default when using `./certs/fullchain.pem`. Change only if your mounted certificate path differs. |
| `FRONTEND_SSL_KEY_PATH` | `/certs/privkey.pem` | Private key file path inside the nginx container. | Keep the default when using `./certs/privkey.pem`. Protect this file and never commit real private keys. |
| `FRONTEND_SSL_CHAIN_PATH` | empty | Optional CA or intermediate chain path used by nginx `ssl_trusted_certificate`. | Leave empty unless your certificate provider requires a separate trusted chain file. |
| `DEVELOPMENT_MODE` | `false` | Enables development behavior, including docs exposure. | Keep `false` by default. Never enable this in production. |
| `ENABLE_DOCS` | `false` | Controls FastAPI `/docs` and `/openapi.json` exposure when not overridden by `DEVELOPMENT_MODE`. | Keep `false` in production. Enable only for local debugging or restricted non-production environments. |
| `ALLOW_INSECURE_PRODUCTION_CONFIGURATION` | `false` | Allows startup even when production guardrails detect unsafe settings. | Keep `false`. Set `true` only for a deliberate temporary exception that has been reviewed. |
| `ALLOWED_HOSTS` | `*` | Trusted host allowlist for FastAPI host validation. Supports comma-separated hostnames. | `*` is fine for local development only. Before exposing the service, use explicit hostnames such as `renderer.example.com`. |
| `API_KEY_AUTH_ENABLED` | `true` | Enables API key authentication for render requests. | Keep `true` in production and shared environments. Disable only for isolated local debugging. |
| `API_KEYS` | empty | Comma-separated API keys accepted by the backend. All keys must be at least 16 characters. | Let setup generate a strong local key. Before exposing the service, create fresh long random secrets for that deployment, rotate by temporarily listing old and new keys, and store them outside source control. |
| `RENDER_TIMEOUT_SECONDS` | `180` | Maximum time allowed for one render request. | Keep high enough for complex slide decks. Lower it if you need stricter resource protection. |
| `RENDER_QUEUE_TIMEOUT_MS` | `500` | Maximum time a request waits for an available render slot before returning `429`. | Keep low for fast backpressure. Increase only if clients should wait instead of retrying. |
| `PAGE_LOAD_TIMEOUT_MS` | `30000` | Playwright page navigation and load timeout in milliseconds. | Keep below `RENDER_TIMEOUT_SECONDS * 1000`. Increase for heavy HTML, slow assets, or complex client-side rendering. |
| `MAX_CONCURRENT_RENDERS` | `2` | Maximum number of render jobs that can run at the same time. | Tune based on CPU and memory. Start small; Playwright is resource-heavy. |
| `BACKEND_MEMORY_LIMIT` | `2g` | Docker Compose memory limit for the backend renderer container. | Size for expected deck complexity and concurrency. Keep a hard limit in production. |
| `BACKEND_CPUS` | `2.0` | Docker Compose CPU limit for the backend renderer container. | Tune with `MAX_CONCURRENT_RENDERS`; Playwright is CPU-heavy. |
| `NGINX_MEMORY_LIMIT` | `256m` | Docker Compose memory limit for nginx. | Keep bounded unless large request buffering needs more headroom. |
| `NGINX_CPUS` | `0.5` | Docker Compose CPU limit for nginx. | Increase only if nginx becomes the bottleneck. |
| `MAX_REQUEST_BODY_BYTES` | `180000000` | Maximum accepted HTTP request body size in bytes. | Set to the smallest value that fits expected decks and assets. Must be at least `MAX_HTML_CHARS` and `MAX_TOTAL_ASSET_BYTES`. |
| `MAX_HTML_CHARS` | `2000000` | Maximum number of characters accepted in the `html` request field. | Keep bounded to prevent oversized render inputs. Increase only for known large deck workloads. |
| `MAX_INPUT_FILES` | `32` | Maximum number of files accepted in `input_files`. | Keep low unless decks genuinely need many assets. Raising this also increases validation and storage pressure. |
| `MAX_SLIDES` | `200` | Maximum number of `.slide` elements rendered from one request. | Set to the largest deck size you intentionally support. This protects Chromium and ZIP generation from runaway documents. |
| `MAX_ASSET_BYTES` | `25000000` | Maximum decoded size for one uploaded asset. | Keep below `MAX_TOTAL_ASSET_BYTES`. Use compressed images where possible. |
| `MAX_TOTAL_ASSET_BYTES` | `120000000` | Maximum decoded size of all uploaded assets combined. | Keep below `MAX_REQUEST_BODY_BYTES`. Size it for expected deck assets while leaving room for HTML and request overhead. |
| `MAX_RENDER_OUTPUT_BYTES` | `220000000` | Maximum generated output size before compression and as the final ZIP response. | Keep bounded to protect memory. Increase only after load testing with representative decks. |

Important production guardrails:

- `DEVELOPMENT_MODE` must be `false`.
- `ENABLE_DOCS` must be `false`.
- `API_KEY_AUTH_ENABLED` must be `true`.
- `ALLOWED_HOSTS` must not contain `*`.
- `ALLOW_INSECURE_PRODUCTION_CONFIGURATION` should remain `false`.

## Health endpoints

- `GET /livez`: nginx/backend process liveness
- `GET /readyz`: full service readiness, including runtime/config checks
- `GET /healthz`: backward-compatible alias for `/readyz`

## License

This app is licensed under the Apache License 2.0. See `LICENSE`.
