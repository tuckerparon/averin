# Development Plan
**Product:** Averin Health
**Last Updated:** 2026-06-03

---

## Current State (main branch)

What already exists and works:

| Component | Current | Target |
|-----------|---------|--------|
| Framework | Flask | FastAPI |
| LLM | Gemini 2.5 Flash | Azure OpenAI Service (GPT-4o) |
| PDF parsing | pdfplumber | Azure Document Intelligence |
| Patient data | CSV (pandas) | FHIR R4 → InterSystems IRIS (Synthea) |
| Database | In-memory + JSON file | PostgreSQL + pgvector |
| Auth | Hardcoded session | Azure Active Directory B2C |
| Deployment | Vercel (Flask) | Docker + Azure Container Apps |
| Star rating | Estimated formula | CMS public data (data.cms.gov) |
| Financial model | Single rough formula | Payment model types (bonus, withhold, shared savings) |
| Frontend | HTML/CSS/JS (built) | Keep — wire to new backend |

**Key insight:** The metric computation logic, gap calculation, chat context builder, and contract parsing prompt are already written in `app.py`. These are the hardest parts. The build is primarily a migration + infrastructure layer, not a from-scratch effort.

---

## What to Port vs. Rebuild

**Port directly (logic is correct, just change the wrapper):**
- `calc_perf()` functions — keep the logic, swap CSV for FHIR queries later
- `metric_status()` — keep as-is
- `estimate_gap()` — keep as-is
- `infer_performance_key()` — keep as-is, extend as needed
- `PARSE_PROMPT` — keep, switch API call from Gemini to Azure OpenAI
- `build_chat_context()` — keep, enhance with pgvector retrieval
- `CHAT_SYSTEM` prompt — keep as-is

**Replace:**
- `pdfplumber` → Azure Document Intelligence
- `genai.Client` (Gemini) → `openai.AzureOpenAI` client
- In-memory `parsed_contracts` dict → PostgreSQL
- CSV `patients.csv` → FHIR queries (InterSystems IRIS + Synthea)
- Flask routes → FastAPI routes
- Hardcoded `star_rating()` formula → CMS data.cms.gov

**Keep unchanged for now:**
- Frontend HTML/CSS/JS — just update the API base URL to point at FastAPI
- Contract PDFs in `/contracts` — use for testing

---

## Phase 1: Project Setup & Infrastructure
**Goal:** Local dev environment running with Docker + PostgreSQL + pgvector

### Tasks
- [ ] Initialize FastAPI project under `backend/`
- [ ] Write `backend/Dockerfile` (Python 3.12, FastAPI, uvicorn)
- [ ] Write `docker-compose.yml` (api + postgres + redis services)
- [ ] Enable pgvector extension on PostgreSQL
- [ ] Run database migrations to create schema (SQLAlchemy + Alembic):
  - `contracts`, `metrics`, `contract_chunks`, `performance_gaps`, `chat_sessions`, `chat_messages`
- [ ] Set up `.env` with Azure keys, DB connection string
- [ ] Confirm `docker-compose up` starts api + db + redis cleanly

**Dependency:** Nothing — start here.

---

## Phase 2: Contract Ingestion Pipeline
**Goal:** PDF upload → Azure Document Intelligence → Azure OpenAI extraction → metrics stored in PostgreSQL

### Tasks
- [ ] `POST /contracts` — accept PDF, store in Azure Blob Storage, create contract record
- [ ] Azure Document Intelligence call — extract structured text from PDF
- [ ] Port `PARSE_PROMPT` + Gemini call to Azure OpenAI Service (GPT-4o)
- [ ] Parse LLM JSON response, validate fields, write to `metrics` table
- [ ] Chunk contract text, generate embeddings (Azure OpenAI `text-embedding-3-small`), store in `contract_chunks` with pgvector
- [ ] `GET /contracts` — list contracts with extraction status
- [ ] `GET /contracts/{id}/metrics` — return extracted metrics
- [ ] Handle extraction edge cases: low confidence, missing fields, ambiguous operators
- [ ] Test against existing `contracts/contract_aetna.pdf`, `contract_humana.pdf`, `contract_unitedhealth.pdf`

**Dependency:** Phase 1 complete.

---

## Phase 3: EHR Simulation (Synthea + InterSystems IRIS)
**Goal:** Realistic synthetic patient population queryable via FHIR R4

### Tasks
- [ ] Generate Synthea population: `java -jar synthea.jar -p 10000 -s 12345 Massachusetts`
- [ ] Configure Synthea disease prevalence (hypertension ~30%, diabetes ~11%, depression ~8%)
- [ ] Load FHIR R4 bundles into InterSystems IRIS via `$import`
- [ ] Confirm IRIS FHIR R4 server responds: `GET /fhir/r4/Patient?_count=5`
- [ ] Write FHIR metric computation engine — port `calc_perf()` logic from CSV to FHIR queries:
  - `bp_control` → FHIR Patient + Condition (I10) + Observation (8480-6, 8462-4)
  - `diabetes_a1c_control` → Condition (E11) + Observation (4548-4)
  - `breast_cancer_screening` → Patient (F, 50-74) + Procedure (mammogram CPT)
  - `colorectal_screening` → Procedure (colonoscopy CPT)
  - `cervical_screening` → Patient (F, 21-64) + Procedure (Pap CPT)
  - `annual_wellness_visit` → Encounter (AWV CPT)
  - `depression_screening` → Procedure (PHQ-9)
  - `med_adherence_*` → MedicationRequest + dispense records
  - `readmission_rate` → Encounter (inpatient) + follow-up Encounter within 30 days
  - `ed_utilization` → Encounter (emergency)
- [ ] Enforce aggregation boundary: only counts/rates leave this layer, no patient IDs
- [ ] Write results to `performance_gaps` table with `computed_at` timestamp
- [ ] `POST /ehr/sync` — trigger sync, `GET /ehr/sync/status` — check progress
- [ ] `GET /payers/{id}/metrics` — return metrics with performance data joined

**Dependency:** Phase 2 complete (need metric definitions to query against).

**Interim option:** Keep CSV-based `calc_perf()` as a fallback while IRIS is being set up. The Phase 3 FHIR engine slots in as a drop-in replacement since outputs are identical.

---

## Phase 4: Gap Computation & Financial Modeling
**Goal:** Gap flags, CLOSEABLE/NEGOTIATE classification, opportunity_$ per payment model

### Tasks
- [ ] Gap computation: `gap_pp = rate - target` (signed, stored in `performance_gaps`)
- [ ] Status computation: failing / at_risk / on_track thresholds
- [ ] Opportunity flag: `CLOSEABLE` vs `NEGOTIATE` (starting threshold: gap > 30pp → NEGOTIATE)
- [ ] Payment model calculator:
  - `quality_bonus`: `gap_pp × denominator_count × value_per_patient_per_pp`
  - `quality_withhold`: `withheld_amount × (failing_metrics / total_withhold_metrics)`
  - `shared_savings`: flag as estimate, surface sharing rate delta
- [ ] `GET /payers` — payer summary cards with total opportunity_$, status counts
- [ ] `GET /metrics/{id}` — drill-down with contract source, EHR fields, gap, opportunity, clinical actions

**Dependency:** Phase 3 (need performance data to compute gaps against).

---

## Phase 5: CMS Star Rating Integration
**Goal:** Display official CMS Star Rating per payer, map to clinical measures

### Tasks
- [ ] Download CMS Star Ratings CSV from `data.cms.gov/medicare-part-d/star-ratings`
- [ ] Load into PostgreSQL: contract ID, plan ID, overall stars, measure-level stars
- [ ] Map payer names in contracts to CMS contract IDs (may require manual mapping table for v1)
- [ ] `GET /payers` — include official CMS star rating from loaded data
- [ ] Compute `cms_star_impact` per metric: distance from current measure tier to next cut-point
- [ ] Store cut-points as static config (updated annually each October)

**Dependency:** Phase 2 (need payer records to join CMS data to).

---

## Phase 6: Chatbot (RAG + Azure OpenAI)
**Goal:** Working chatbot with contract-aware, PHI-free context

### Tasks
- [ ] `POST /chat` — accept message + session history, return streaming response
- [ ] Build retrieval: pgvector cosine similarity search on `contract_chunks` for relevant contract clauses
- [ ] Build context: pull metric summaries + performance from PostgreSQL (aggregated only)
- [ ] Port `CHAT_SYSTEM` prompt + `build_chat_context()` to use DB instead of in-memory dict
- [ ] Switch LLM call from Gemini to Azure OpenAI Service (GPT-4o) with streaming
- [ ] Generate and cache `clinical_actions_json` per metric nightly (store in `performance_gaps`)
- [ ] `GET /chat/history` — retrieve session history
- [ ] Enforce: no patient IDs, no raw FHIR results, no PHI ever enters prompt

**Dependency:** Phases 3 + 4 (need performance data in DB for context).

---

## Phase 7: Frontend Integration
**Goal:** Existing frontend wired to new FastAPI backend

### Tasks
- [ ] Update API base URL in `static/app.js` to point at FastAPI (`localhost:8000` locally, Container Apps URL in prod)
- [ ] Verify all existing API calls match new endpoint signatures:
  - `POST /api/parse-contract` → `POST /contracts`
  - `GET /api/performance/{payer}` → `GET /payers/{id}/metrics`
  - `POST /api/chat` → `POST /chat`
- [ ] Update response shapes in JS if field names changed
- [ ] Test all UI flows end-to-end against new backend
- [ ] Optionally: migrate from Flask templates to Next.js (defer if frontend is working)

**Dependency:** Phases 2-6 (endpoints must exist).

---

## Phase 8: Auth
**Goal:** Proper login gating — at minimum for demo, properly for production

### Tasks
- [ ] Azure Active Directory B2C tenant setup
- [ ] FastAPI auth middleware: validate JWT from AAD on all `/api/*` routes
- [ ] Define roles: `admin` (upload + sync), `executive` (read + chat)
- [ ] Update frontend login flow to use AAD login page (or keep simple session for demo)

**Dependency:** Phase 7 (don't build auth before the app works).

**Demo shortcut:** Keep the existing hardcoded session login for the demo, then add proper AAD auth before any real hospital use.

---

## Phase 9: Deployment
**Goal:** Running on Azure, accessible via URL

### Tasks
- [ ] Azure Container Registry: push Docker image
- [ ] Azure Container Apps: deploy FastAPI container
- [ ] Azure Database for PostgreSQL Flexible Server: provision + run migrations
- [ ] Azure Blob Storage: provision for contract PDFs
- [ ] Azure OpenAI Service: deploy GPT-4o + text-embedding-3-small
- [ ] Azure Document Intelligence: provision
- [ ] Azure Cache for Redis: provision
- [ ] Azure Key Vault: store all secrets
- [ ] Vercel: deploy frontend (or keep on current Vercel deployment, just update API URL)
- [ ] End-to-end smoke test in production environment

**Dependency:** All phases complete.

---

## Sequencing Summary

```
Phase 1: Infrastructure (setup)
    ↓
Phase 2: Contract pipeline          Phase 5: CMS Stars
    ↓                                   ↓
Phase 3: EHR / FHIR ──────────────────────────────┐
    ↓                                              ↓
Phase 4: Gap & Financial                    Phase 6: Chatbot
    ↓                                              ↓
Phase 7: Frontend integration ←────────────────────┘
    ↓
Phase 8: Auth
    ↓
Phase 9: Deployment
```

Phases 2 and 5 can run in parallel.
Phases 4 and 6 can run in parallel after Phase 3.

---

## Open Items Before Coding Starts

Before any phase begins, the following should be resolved per `ai_assisted_coding_rules.md`:
- [ ] Human review of `technical_requirements.md` — sign off before coding
- [ ] Unit tests defined for each phase (especially metric computation engine)
- [ ] Open questions in `open_questions.md` — resolve or formally defer each one
- [ ] Azure credentials confirmed accessible (Microsoft hackathon tokens)
- [ ] InterSystems IRIS access confirmed (hackathon partner)
