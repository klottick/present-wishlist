# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.21.0-slim AS frontend
WORKDIR /build/frontend
RUN --mount=type=bind,source=frontend/package.json,target=package.json \
    --mount=type=bind,source=frontend/package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm npm ci
COPY --link frontend/ ./
RUN npm run build

FROM python:3.14.4-slim AS runtime
WORKDIR /app
RUN --mount=type=bind,source=backend/requirements.txt,target=/tmp/requirements.txt \
    --mount=type=cache,target=/root/.cache/pip \
    python -m pip install --upgrade pip==26.2.1 \
    && python -m pip install -r /tmp/requirements.txt
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent app \
    && install -d -m 0700 -o 10001 -g 10001 /data
COPY --link backend/ /app/backend/
COPY --link scripts/container_entrypoint.py /app/scripts/container_entrypoint.py
COPY --link --from=frontend /build/frontend/dist/ /app/frontend/dist/
ARG VCS_REF=unknown
ARG VERSION=unreleased
LABEL org.opencontainers.image.source="https://github.com/klottick/present-wishlist" \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.version=$VERSION
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DJANGO_SETTINGS_MODULE=project.release_settings
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz/', timeout=2).close()"]
ENTRYPOINT ["python", "/app/scripts/container_entrypoint.py"]
