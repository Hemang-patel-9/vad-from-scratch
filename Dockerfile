# Stage 1 - build the Next.js static export (output: 'export' -> frontend/out)
FROM node:22-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2 - FastAPI serves the API and the exported frontend on one port
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
# Generous timeout and retries because this layer pulls llvmlite, scipy and
# onnxruntime — tens of megabytes each. pip gives up after 15 s of silence by
# default, which a slow link hits often enough to fail the build on nothing.
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

COPY backend/ ./
COPY samples/ ./samples/
COPY --from=frontend /build/out ./static

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
