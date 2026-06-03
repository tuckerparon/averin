# Averin Health

AI-powered Value-Based Care contract intelligence platform for hospital executives.

Upload payer contracts → extract quality metrics → compare to live EHR performance → surface gaps and negotiation levers.

---

## Stack

| Layer | Technology |
|-------|-----------|
| API | FastAPI (Python 3.12) |
| Database | PostgreSQL + pgvector |
| EHR (dev) | InterSystems IRIS for Health + Synthea |
| LLM | Azure OpenAI Service (GPT-4o) |
| Document AI | Azure Document Intelligence |
| Cache | Redis |
| Frontend | Next.js (existing HTML/JS for v0) |
| Deployment | Docker + Azure Container Apps |

---

## Local Development

### Prerequisites
- Docker Desktop
- Python 3.12
- Java 11+ (for Synthea)

### 1. Clone and configure

```bash
git clone https://github.com/tuckerparon/averin.git
cd averin
cp .env.example .env   # fill in Azure keys
```

### 2. Download Synthea

```bash
curl -L https://github.com/synthetichealth/synthea/releases/download/master-branch-latest/synthea-with-dependencies.jar -o synthea.jar
```

### 3. Start IRIS (FHIR server)

```bash
docker run -d \
  --name iris-health \
  -p 1972:1972 \
  -p 52773:52773 \
  containers.intersystems.com/intersystems/irishealth-community:2026.1
```

Then open `http://localhost:52773` and complete the FHIR server setup (see [IRIS Setup](#iris-setup) below).

### 4. Generate and load synthetic patients

```bash
java -jar synthea.jar -p 1000 Massachusetts
python3 scripts/load_synthea.py
```

### 5. Start the backend

```bash
docker-compose up
```

API runs at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

### 6. Run migrations

```bash
docker-compose exec api alembic upgrade head
```

---

## IRIS Setup

After starting the IRIS container:

1. Go to `http://localhost:52773` → log in as `_SYSTEM`
2. Top nav → **Installer Wizard** → **Configure Foundation** (name: `AVERIN`) → Save → Activate
3. Top nav → **FHIR** → **Add New Server**
   - Namespace: `AVERIN`
   - URL: `/csp/healthshare/averin/fhir/r4`
   - FHIR Version: R4
4. Verify: `curl http://localhost:52773/csp/healthshare/averin/fhir/r4/metadata`

---

## Project Structure

```
averin/
├── backend/
│   ├── api/           # FastAPI route handlers
│   ├── extraction/    # Contract PDF → metrics pipeline
│   ├── ehr/           # FHIR integration + metric computation engine
│   ├── chatbot/       # RAG context + Azure OpenAI
│   ├── models/        # SQLAlchemy models
│   └── db/            # Alembic migrations
├── contracts/         # Sample payer PDFs for testing
├── data/              # patients.csv (CSV fallback for dev)
├── scripts/           # Synthea loader and utilities
├── frontend/          # Next.js app (coming soon)
├── infra/             # Azure Bicep IaC (coming soon)
└── tests/
```

---

## Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/contracts` | Upload payer contract PDF |
| `GET` | `/contracts` | List all contracts |
| `GET` | `/payers` | Payer summary cards |
| `GET` | `/payers/{id}/metrics` | Metrics with performance data |
| `POST` | `/ehr/sync` | Trigger FHIR metric refresh |
| `GET` | `/ehr/sync/results` | Latest computed metric rates |
| `POST` | `/chat` | Chatbot query |

Interactive docs: `http://localhost:8000/docs`
