FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx/renderer.conf.template /opt/renderer/renderer.conf.template
COPY --chmod=0755 nginx/bin/render-config.sh /docker-entrypoint.d/40-renderer-config.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/readyz || exit 1
