# Averin Health

AI-powered Value-Based Care contract intelligence platform for hospital executives.

Upload payer contracts → extract quality metrics → compare to live EHR performance → surface gaps and negotiation levers.

**Live:** [www.averin.health](https://www.averin.health) (password: `averin2026`)

---

## Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI (Python 3.12) |
| Database | PostgreSQL (Azure Database for PostgreSQL / local Docker) |
| EHR (FHIR) | Azure Health Data Services — FHIR R4 |
| Document AI | Azure Document Intelligence (`prebuilt-read`) |
| LLM — extraction | Google Gemini (`gemini-2.5-flash-lite`) |
| LLM — chatbot | Google Gemini (`gemini-2.5-flash-lite`) |
| Synthetic patients | Synthea → Azure FHIR |
| Frontend | HTML / JS / CSS (served by FastAPI) |
| Deployment | Docker + Azure Container Apps |
| Container registry | Azure Container Registry (`averinregistry`) |

---

## Architecture

```
PDF upload
  → Azure Document Intelligence  (PDF → clean text)
  → Gemini 2.5-flash-lite        (text → structured metrics JSON)
  → PostgreSQL                   (metrics, gaps, contract metadata)

EHR sync
  → Azure FHIR R4                (Patient, Condition, Observation, Procedure, Encounter)
  → metrics.py                   (FHIR queries → aggregated rates, no PHI leaves FHIR)
  → PostgreSQL                   (performance_gaps: rate, gap_pp, opportunity_dollars)

Chatbot
  → PostgreSQL                   (build PHI-free context string)
  → Gemini 2.5-flash-lite        (context + conversation history → response)
```

---

## Local Development

### Prerequisites
- Docker Desktop
- Python 3.9+ (for running `load_synthea.py` locally)
- Java 11+ (for Synthea patient generation)

### 1. Clone and configure

```bash
git clone https://github.com/tuckerparon/averin.git
cd averin
cp .env.example .env   # fill in Azure keys
```

Required `.env` values:
- `AZURE_FHIR_URL` — Azure Health Data Services FHIR endpoint
- `AZURE_FHIR_TENANT_ID`, `AZURE_FHIR_CLIENT_ID`, `AZURE_FHIR_CLIENT_SECRET` — service principal credentials
- `GEMINI_API_KEY` — Google AI Studio key
- `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` + `AZURE_DOCUMENT_INTELLIGENCE_KEY`
- `AZURE_STORAGE_CONNECTION_STRING` + `AZURE_STORAGE_CONTAINER`
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `DEMO_PASSWORD` — login gate password

### 2. Start the backend

```bash
docker-compose up
```

API runs at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

Migrations run automatically on startup (`alembic upgrade head`).

### 3. Load synthetic patients into Azure FHIR

```bash
# Generate Synthea data
java -jar synthea.jar -p 200 Massachusetts

# Load into Azure FHIR (reads credentials from .env)
pip install python-dotenv requests
python3 scripts/load_synthea.py
```

### 4. Trigger EHR sync

```bash
curl -s -X POST http://localhost:8000/ehr/sync
```

---

## Deployment

### Build and push image (Apple Silicon — requires amd64 cross-compile)

```bash
docker build --platform linux/amd64 -t averinregistry.azurecr.io/averin-api:latest .
docker push averinregistry.azurecr.io/averin-api:latest
```

### Update live Container App

```bash
az containerapp update \
  --name averin-api \
  --resource-group averin-rg \
  --image averinregistry.azurecr.io/averin-api:latest
```

### First-time deployment

See `deploy.sh` — requires Azure CLI and env vars set from `.env`.

---

## Project Structure

```
averin/
├── Dockerfile             # Production image (bakes frontend + contracts in)
├── deploy.sh              # Azure Container Apps deployment script
├── docker-compose.yml     # Local development (API + PostgreSQL + Redis)
├── backend/
│   ├── api/               # FastAPI route handlers (contracts, payers, ehr, chat)
│   ├── extraction/        # PDF → text → metrics pipeline (Doc Intelligence + Gemini)
│   ├── ehr/               # Azure FHIR client + HEDIS metric computation engine
│   ├── chatbot/           # Context builder + Gemini chat handler
│   ├── models/            # SQLAlchemy ORM models
│   └── db/                # Alembic migrations
├── frontend/
│   ├── static/            # CSS, JS, logo
│   └── templates/         # HTML (index, login)
├── contracts/             # Sample payer PDFs (Aetna, Humana, UnitedHealth, Meridian)
├── scripts/               # Synthea loader
├── tests/                 # Unit tests (gap computation) + integration tests (extraction)
└── docs/                  # Traceability matrix
```

---

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/contracts` | Upload payer contract PDF |
| `GET` | `/contracts` | List all contracts |
| `GET` | `/payers` | Payer summary cards with star ratings |
| `GET` | `/payers/{id}/metrics` | Metrics with EHR performance data |
| `POST` | `/ehr/sync` | Trigger FHIR metric refresh |
| `GET` | `/ehr/sync/status` | Sync status and last run time |
| `POST` | `/chat` | Chatbot query with DB context |
| `POST` | `/auth/login` | Demo password gate |

Interactive docs: `http://localhost:8000/docs`

---

## Tests

```bash
# Unit tests — no external deps required
docker-compose exec api python -m pytest /tests/test_gap_computation.py -v

# Integration tests — requires Azure Document Intelligence + Gemini keys
docker-compose exec api python -m pytest /tests/test_extraction.py -v -m integration
```
