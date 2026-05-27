# GCP Deployment Guide — StoneDesk

## Architecture Overview

```
┌─────────────────────────┐     HTTPS      ┌────────────────────────────┐
│   Cloud Run             │ ◄────────────► │   Cloud Run                │
│   stonedesk-frontend    │                │   stonedesk-backend        │
│   (nginx, port 8080)    │                │   (uvicorn FastAPI, $PORT) │
└─────────────────────────┘                └────────────┬───────────────┘
                                                        │ TLS / SRV
                                                        ▼
                                            ┌───────────────────────────┐
                                            │   MongoDB Atlas            │
                                            │   (external, unchanged)   │
                                            └───────────────────────────┘
```

| Layer    | Service             | Notes                              |
|----------|---------------------|------------------------------------|
| Frontend | Cloud Run           | nginx serving Vite production build |
| Backend  | Cloud Run           | FastAPI + uvicorn                  |
| Database | MongoDB Atlas       | No changes required                |
| Registry | Google Container Registry (GCR) or Artifact Registry |

---

## Required GCP Services

- Cloud Run (backend + frontend)
- Google Container Registry (or Artifact Registry)
- Cloud Build (for CI/CD via `cloudbuild.yaml`)
- Secret Manager (recommended for `MONGODB_URI`)

---

## Environment Variables

### Backend (set in Cloud Run service)

| Variable              | Required | Description                                              |
|-----------------------|----------|----------------------------------------------------------|
| `MONGODB_URI`         | Yes      | Full MongoDB Atlas connection string (store as Secret)   |
| `MONGODB_DB`          | Yes      | Database name (e.g. `virgin`)                            |
| `CORS_ORIGINS`        | Yes      | Comma-separated list of allowed frontend origins         |
| `ALLOW_MEMORY_FALLBACK` | No     | `false` in production — fail fast if DB unavailable      |
| `PORT`                | Auto     | Injected by Cloud Run (default 8080). App reads `$PORT`. |

`CORS_ORIGINS` must include the Cloud Run frontend URL once deployed:
```
CORS_ORIGINS=https://stonedesk-frontend-xxxxxxxxxx-uc.a.run.app
```

### Frontend (set at Docker build time via `--build-arg`)

| Variable       | Required | Description                                         |
|----------------|----------|-----------------------------------------------------|
| `VITE_API_URL` | Yes      | Full URL to backend `/api` prefix (baked at build)  |

Example: `https://stonedesk-backend-xxxxxxxxxx-uc.a.run.app/api`

> **Important:** Vite bakes `VITE_*` variables into the static bundle at build time.
> You must rebuild the frontend image whenever the backend URL changes.

---

## Deployment Steps (First Time)

### 1. Set up GCP project

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com secretmanager.googleapis.com
```

### 2. Store the MongoDB URI as a Secret

```bash
echo -n "mongodb+srv://user:pass@cluster.mongodb.net/virgin" | \
  gcloud secrets create stonedesk-mongodb-uri --data-file=-
```

### 3. Build & deploy the backend

```bash
cd backend
docker build -t gcr.io/YOUR_PROJECT_ID/stonedesk-backend .
docker push gcr.io/YOUR_PROJECT_ID/stonedesk-backend

gcloud run deploy stonedesk-backend \
  --image gcr.io/YOUR_PROJECT_ID/stonedesk-backend \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars MONGODB_DB=virgin \
  --update-secrets MONGODB_URI=stonedesk-mongodb-uri:latest
```

Note the backend URL from the output (e.g. `https://stonedesk-backend-xxxxxxxxxx-uc.a.run.app`).

### 4. Update backend CORS to allow the frontend

After frontend is deployed (step 5), update `CORS_ORIGINS`:

```bash
gcloud run services update stonedesk-backend \
  --region us-central1 \
  --update-env-vars CORS_ORIGINS=https://stonedesk-frontend-xxxxxxxxxx-uc.a.run.app
```

### 5. Build & deploy the frontend

```bash
cd frontend
docker build \
  --build-arg VITE_API_URL=https://stonedesk-backend-xxxxxxxxxx-uc.a.run.app/api \
  -t gcr.io/YOUR_PROJECT_ID/stonedesk-frontend .
docker push gcr.io/YOUR_PROJECT_ID/stonedesk-frontend

gcloud run deploy stonedesk-frontend \
  --image gcr.io/YOUR_PROJECT_ID/stonedesk-frontend \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated
```

---

## CI/CD via Cloud Build

The root `cloudbuild.yaml` automates both builds and deployments.

Before using it, update the `_BACKEND_URL` substitution with the real backend URL:

```bash
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _BACKEND_URL=https://stonedesk-backend-xxxxxxxxxx-uc.a.run.app
```

Or connect a GitHub trigger in the Cloud Build console and pin `_BACKEND_URL` in the trigger substitutions.

---

## Local Validation

### Backend

```bash
cd backend

# Build
docker build -t stonedesk-backend .

# Run (replace URI with Atlas connection string)
docker run --rm -p 8080:8080 \
  -e MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/virgin" \
  -e MONGODB_DB="virgin" \
  -e PORT=8080 \
  stonedesk-backend

# Health check
curl http://localhost:8080/health
# → {"status":"ok"}
```

### Frontend

```bash
cd frontend

# Production build test (without Docker)
VITE_API_URL=http://localhost:8080/api npm run build
npm run preview
# → open http://localhost:4173

# Docker build (with backend URL baked in)
docker build \
  --build-arg VITE_API_URL=http://localhost:8080/api \
  -t stonedesk-frontend .

docker run --rm -p 8080:8080 stonedesk-frontend
# → open http://localhost:8080
```

---

## Rollback

Cloud Run keeps all previous revisions. To roll back:

```bash
# List revisions
gcloud run revisions list --service stonedesk-backend --region us-central1

# Route 100% traffic to a previous revision
gcloud run services update-traffic stonedesk-backend \
  --region us-central1 \
  --to-revisions stonedesk-backend-00001-abc=100
```

Same pattern applies to `stonedesk-frontend`.

---

## Notes

- `sqlalchemy` and `psycopg2-binary` are present in `requirements.txt` but not imported by the active application. They are safe to remove in a future cleanup to reduce image size.
- The Vercel CORS entries in `main.py` are harmless and can be removed once the Vercel deployment is fully retired.
- `MONGODB_URI` has no default in production — the app will refuse to start without it (unless `ALLOW_MEMORY_FALLBACK=true`, which is not recommended in production).
