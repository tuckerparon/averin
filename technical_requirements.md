# Technical Requirements

**Product:** Averin Health: Value-Based Care Contract Intelligence Platform  
**Stack:** Python, FastAPI, Docker, Azure Container Apps, Azure OpenAI Service, Next.js, PostgreSQL + pgvector
**Last Updated:** 2026-06-03

---

## 1. Product Overview

Averin Insight allows hospital medical executives to upload their payer Value-Based Care (VBC) contracts, automatically extract every quality metric and target, compare them to live EHR performance data, and surface two distinct opportunities: (1) closing performance gaps to capture available bonuses, and (2) identifying gaps so large they signal an unrealistic target — giving executives data-backed leverage to negotiate better terms. A chatbot layer lets executives query gaps, trends, and negotiation levers in natural language.

**Workflow:**
1. Executive uploads a payer VBC contract (PDF)
2. System extracts every metric, its target, measurement definition, numerator/denominator logic, and the exact contract language
3. System pulls the corresponding aggregated metric from the EHR
4. System computes the gap (performance vs. target) in percentage points
5. System flags each metric as: closeable gap (intervention opportunity) or unrealistic target (negotiation opportunity)
6. Executive queries the data through an AI chatbot

**User Interface (UI):**
- Per-payer cards with the official CMS Star Rating for that plan (pulled from CMS public data) and total potential opportunity ($). Note: CMS assigns star ratings to Medicare Advantage *plans*, not health systems — Averin shows how the health system's clinical performance is moving that plan's rating.
- Per-metric rows: Measure | Target | Performance | Gap (PP)
- Status labels: Failing | At Risk | On Track
- Context for each metric: exact contract source text, EHR data fields needed, clinical action recommendations
- AI chatbot: Selectable questions ("What's our biggest care gap?", "How can we improve our star rating?", "Which payer contract is most favorable?") and an open input chat window for more specific asks.

---

## 2. System Architecture

### 2.1 High-Level Components

```
[User (Browser)]
      |
      v
[Frontend — Next.js]
      |
      v
[API Layer — FastAPI on Azure]
      |
      +----> [Contract Pipeline]
      |          Azure Blob Storage (raw PDFs)
      |          Azure Document Intelligence (PDF → structured text)
      |          Azure OpenAI Service (metric extraction & normalization)
      |          └──> PostgreSQL + pgvector (metrics + contract text vectors)
      |
      +----> [EHR Integration Layer]
      |          FHIR R4 API (InterSystems IRIS for v0 / Epic / Cerner in production)
      |          Metric computation engine (aggregation only — NO patient data leaves)
      |          Azure Redis (cache for computed rates)
      |          └──> PostgreSQL (performance + gap data)
      |
      +----> [Chatbot Layer]
                 Azure OpenAI Service (GPT-4o)
                 Context: aggregated metrics only, NO PHI ever enters LLM
                 Retrieval: PostgreSQL metrics + pgvector contract text search
```

### 2.2 Data Flow

```
PDF Upload
  -> Azure Blob Storage (raw, immutable)
  -> Azure Document Intelligence (text extraction, layout)
  -> LLM Extraction Pipeline (metric identification, normalization)
  -> Metric Store (structured: metric name, target, operator, period, denominator logic, numerator logic, contract text chunk, LOINC/ICD codes)

EHR Sync (batch, nightly or on-demand)
  -> FHIR R4 queries against InterSystems IRIS
  -> Aggregation engine (computes rates, NO patient-level data leaves this layer)
  -> Metric Store (updates performance values)

CMS Stars Sync (annual, on CMS release ~October)
  -> Pull star ratings CSV from data.cms.gov
  -> Match payer plan contract ID to payer records
  -> Store official star rating + measure-level ratings in PostgreSQL
  -> Map CMS HEDIS measures to extracted contract metrics

Gap Computation (triggered after EHR sync)
  -> gap_pp = performance - target
  -> status = "failing" | "at risk" | "on track"
  -> opportunity_flag = CLOSEABLE | NEGOTIATE
  -> opportunity_$ = gap_pp * estimated_patient_volume * per_pp_financial_weight
  -> cms_star_impact = distance from current measure star tier to next tier

Chatbot Query
  -> pgvector semantic search over contract text chunks
  -> PostgreSQL query for relevant metric summaries (aggregated only)
  -> Azure OpenAI Service (GPT-4o) generates response
  -> Response streamed to frontend
```

---

## 3. Contract Ingestion & Extraction Pipeline

### 3.1 Input Formats (v0)
- PDF (drag & drop, multiple files, one per payer)

### 3.2 PDF Processing
- **Storage:** Upload to Azure Blob Storage, generate a unique contract ID
- **Text Extraction:** Azure Document Intelligence (Form Recognizer) — handles scanned PDFs via OCR, preserves table structure
- **Chunking Strategy:** Chunk by section (e.g., "Quality Measures", "Performance Targets") — preserve section headers as metadata for citation

### 3.3 Metric Extraction (LLM)
Using Azure OpenAI Service (GPT-4o) with a structured extraction prompt. Each extracted metric must produce:

```json
{
  "metric_id": "uuid",
  "contract_id": "uuid",
  "payer_name": "UnitedHealth",
  "measure_name": "Hypertension: Blood Pressure Control",
  "measure_code": "QM-02",
  "standard_code": "HEDIS CBP",
  "target_value": 72.0,
  "target_operator": ">=",
  "target_unit": "percent",
  "measurement_period": "annual",
  "denominator_definition": "Patients aged 18-85 with diagnosis of essential hypertension (ICD-10: I10) with at least one encounter in the measurement period",
  "numerator_definition": "Patients whose most recent blood pressure reading is < 140/90 mmHg",
  "exclusion_criteria": ["end-stage renal disease", "hospice care", "pregnant patients"],
  "icd10_codes": ["I10"],
  "loinc_codes": ["8480-6", "8462-4"],
  "contract_source_text": "QM-02 Hypertension: Blood Pressure Control Percentage of patients with hypertension (age 18-85)...",
  "financial_weight_pp": null,
  "extraction_confidence": 0.94
}
```

**Edge cases in extraction:**
- Ambiguous operators: "should be maintained below" vs. "must not exceed" — normalize to `<`, `<=`, `>`, `>=`, `=`
- Tiered targets: ">=70% earns bonus tier 1; >=80% earns bonus tier 2" — store as multiple target rows
- Composite measures: one contract clause may define multiple sub-metrics
- Measures defined by reference: "per HEDIS technical specifications" — flag for manual review, link to HEDIS standard definition
- Missing denominator/numerator: some contracts only state the rate and target without full measure spec — flag `extraction_confidence < 0.7` for human review
- Overlapping or duplicate measures across contracts (e.g., both Aetna and Humana define "Hypertension: BP Control") — deduplicate by HEDIS/NCQA code when possible

### 3.4 Metric Normalization
Map extracted metrics to a canonical measure library:
- HEDIS (NCQA) measure codes as the primary canonical identifier
- CMS eCQM codes (e.g., CMS165 for Hypertension Control)
- Custom payer codes mapped to nearest canonical when possible
- Flag unmappable measures for manual review

This normalization is critical: it allows cross-payer comparison ("UnitedHealth and Humana both measure hypertension control — how do our targets compare?")

---

## 4. EHR Integration Layer

### 4.1 v0: InterSystems IRIS for Health (Simulated)

InterSystems provides IRIS for Health, which exposes a FHIR R4 server. For v0, use **Synthea** to generate realistic synthetic patient population data and load it into IRIS.

**Synthea setup:**
- Generate a population of ~5,000–10,000 synthetic patients
- Configure for chronic disease prevalence matching a realistic ambulatory population
- Export as FHIR R4 bundles, import into IRIS

**FHIR resources needed:**
- `Patient` — demographics (age, sex, coverage)
- `Condition` — diagnoses (ICD-10 codes)
- `Observation` — vitals (LOINC codes: BP, A1C, BMI)
- `Procedure` — screenings (CPT codes)
- `MedicationRequest` — prescriptions for adherence metrics
- `Encounter` — visit dates for denominator qualification

### 4.2 Metric Computation Engine

For each extracted metric, the engine builds and executes a FHIR query plan:

```
Metric: Hypertension BP Control
  Step 1: Find denominator — Patient with Condition I10, Encounter in period
  Step 2: Apply exclusions — filter out exclusion diagnoses
  Step 3: Find numerator — most recent Observation (8480-6 Systolic, 8462-4 Diastolic) < 140/90
  Step 4: Compute rate = numerator_count / denominator_count
  Step 5: Return {rate, numerator_count, denominator_count, as_of_date}
```

**Note:** Only aggregated counts and rates are passed upstream. Patient IDs never enter the API layer, metric store, or chatbot context.

**Edge cases:**
- Patient in denominator for multiple payers — counted per-payer independently (correct)
- Measurement period alignment: contract says "rolling 12 months" vs. "calendar year" — must store period type per metric
- Patients with multiple BP readings: use "most recent" per contract spec (not average)
- Patients who switch payers mid-year — scope to patients active with that payer for at least X days (needs clarification)
- Data freshness: tag every computed metric with `computed_at` timestamp; surface staleness warnings to user

### 4.3 Future EHR Integrations (post-v0)
- Epic FHIR R4 (Bulk FHIR export for population-level queries)
- Cerner (Oracle Health) FHIR R4
- Meditech
- Athenahealth
- Authentication: SMART on FHIR (OAuth 2.0)

---

## 5. Financial Opportunity Modeling

The "POTENTIAL OPPORTUNITY" dollar figure shown per payer represents two distinct types of value:

**Type 1 — Closeable gap:** Performance is below target but achievable. Clinical interventions can close the gap and capture the bonus. Flagged as `CLOSEABLE`.

**Type 2 — Negotiation target:** The gap is so large relative to the hospital's patient population that the target is likely unrealistic. The executive's play is to negotiate a lower target, not chase an impossible clinical improvement. Example: if a hospital serves a high-risk urban population and hypertension prevalence is 3x the national average, a payer-mandated 72% BP control target may be structurally unachievable regardless of care quality. Averin surfaces this so the executive can walk into a renegotiation with data. Flagged as `NEGOTIATE`.

The `CLOSEABLE` vs. `NEGOTIATE` threshold should be defined with public health experts — a reasonable starting point is gap > 30pp, but population risk adjustment matters.

### 5.1 Payment Models

VBC contracts pay health systems in several different ways. Averin stores a `payment_model` per contract and applies different opportunity calculations accordingly:

| Payment Model | How it Works | Opportunity Calculation |
|---------------|--------------|------------------------|
| **Quality bonus** | Direct bonus per metric threshold hit | `gap_pp × denominator_count × $/pp` |
| **Quality withhold** | Payer withholds X% of base fee-for-service payments; returned when targets are met | `withheld_amount × fraction_of_targets_failing` |
| **Shared savings** | Health system keeps a % of spend saved vs. benchmark; quality score determines the sharing rate | Requires benchmark spend data — flag as estimate, surface sharing rate impact |
| **CMS Stars indirect** | Higher plan stars → higher CMS payment to MA plan → plan shares more with health system | Shown separately via CMS Stars integration (Section 6) |

For contracts with a `quality_withhold` model, the contract PDF should specify the withhold percentage and which metrics release it. Extract these fields alongside the metric targets.

### 5.2 Inputs (per metric)
- Gap in percentage points
- Denominator count (patient population in scope)
- Payment model type (`quality_bonus` | `quality_withhold` | `shared_savings`)
- Financial parameters: $/pp bonus rate, withhold %, sharing rate — extracted from contract or manually entered
- Tier structure if applicable

### 5.3 Calculations

**Quality bonus:**
```
opportunity_$ = gap_pp × denominator_count × value_per_patient_per_pp
```

**Quality withhold:**
```
opportunity_$ = total_withheld_amount × (failing_metrics / total_withhold_metrics)
```

**Shared savings (estimate only):**
```
opportunity_$ = estimated_savings × (current_sharing_rate_delta)
-- Surface as estimate; requires benchmark spend data not available from EHR
```

### 5.4 Edge Cases
- Metrics where performance already exceeds target — gap is $0, but flag as "at risk of regression"
- Tiered bonuses — compute opportunity at each tier separately, sum if achievable
- Same metric covered by multiple payment mechanisms in one contract — sum contributions
- `value_per_patient_per_pp` not explicit in contract — flag as estimated, allow manual override

---

## 6. API Layer

### 6.1 Technology
- FastAPI (Python) in Docker, deployed to Azure Container Apps

### 6.2 Core Endpoints

```
POST   /contracts                    — Upload PDF, trigger extraction pipeline
GET    /contracts                    — List uploaded contracts
GET    /contracts/{id}               — Contract metadata + extraction status
GET    /contracts/{id}/metrics       — All extracted metrics for a contract
GET    /payers                       — Payer summary cards (star rating, opportunity $, status counts)
GET    /payers/{payer_id}/metrics    — All metrics for a payer with performance data
GET    /metrics/{metric_id}          — Drill-down: contract source, EHR fields, clinical actions, performance
POST   /ehr/sync                     — Trigger EHR metric refresh (admin/scheduled)
GET    /ehr/sync/status              — Status of last sync
POST   /chat                        — Chatbot query (streaming SSE response)
GET    /chat/history                 — Retrieve chat history for session
```

### 6.3 Authentication
- Azure Active Directory (AAD) / Microsoft Entra ID
- JWT tokens
- Roles: `admin` (can upload contracts, trigger syncs), `executive` (read-only + chatbot), `viewer` (read-only)

---

## 7. Chatbot Layer

### 7.1 Design Principle: No PHI in LLM Context

The chatbot context window will NEVER contain:
- Patient names, DOBs, MRNs, or any direct identifiers
- Patient-level records or lists
- Raw EHR query results

It will ONLY contain:
- Aggregated metric rates and counts (e.g., "192 of 770 patients meeting BP target")
- Contract terms and targets
- Gap analysis summaries
- Clinical action recommendations (pre-generated)

### 7.2 RAG Architecture
- **Vector store:** PostgreSQL with pgvector extension — stores contract text chunks as vector embeddings alongside all structured metric data. No separate vector database needed.
- **Indexed documents:**
  - Contract text chunks (with payer, measure, page metadata + embedding vector)
  - Metric summaries (pre-computed: rate, gap, status, financial opportunity)
  - Clinical guideline summaries (pre-loaded, non-PHI)
- **Retrieval:** pgvector cosine similarity search on user query embedding -> top-k chunks -> stuffed into GPT-4o context
- **Model:** Azure OpenAI Service (GPT-4o)

### 7.3 Suggested Prompts
- "What's our biggest care gap?"
- "How can we improve our star rating?"
- "Which payer contract is most favorable?"
- "What's our biggest gap against Humana?"

### 7.4 Clinical Actions Generation
Each metric drill-down shows pre-generated clinical actions. These are generated at each nightly EHR sync by prompting GPT-4o with:
- The metric definition and current gap
- Evidence-based guideline references (pre-loaded context, NOT patient data)
- The EHR fields involved

Example output: "Standardize blood pressure measurement protocols across clinics", "Implement team-based care models including nurses and pharmacists for hypertension management"

Clinical actions are regenerated on every nightly sync. At current scale this is trivial; revisit if regeneration time becomes a bottleneck.

---

## 8. Data Storage

### 8.1 Primary Database
- **PostgreSQL + pgvector on Azure Database for PostgreSQL Flexible Server**
- Single database handles all structured data (contracts, metrics, performance, gaps, chat history) AND vector embeddings for chatbot RAG (contract text chunks)
- pgvector adds a `vector` column type with cosine similarity search — no separate vector database needed
- Keeps all queries in one place; simplifies ops and reduces cost

### 8.2 Schema (PostgreSQL)

Multiple tables — each piece of data stored once, joined when needed. Merging into one table would mean repeating the full metric definition on every performance row.

`performance` and `gaps` are merged into one table since a gap is always derived from a performance record.

```sql
contracts (
  id, payer_name, cms_contract_id, cms_star_rating,
  payment_model,           -- quality_bonus | quality_withhold | shared_savings
  payment_model_params_json,  -- withheld_amount, sharing_rate, etc.
  upload_date, blob_url, extraction_status, extraction_confidence_avg
)

metrics (
  id, contract_id,
  measure_name, measure_code, standard_code,
  target_value, target_operator, target_unit,
  measurement_period,
  denominator_definition, numerator_definition,
  exclusion_criteria_json, icd10_codes_json, loinc_codes_json,
  contract_source_text,
  financial_weight_pp,
  extraction_confidence
)

contract_chunks (
  id, contract_id, metric_id,
  chunk_text, chunk_metadata_json,
  embedding vector(1536)   -- pgvector: for chatbot RAG semantic search
)

performance_gaps (
  id, metric_id,
  numerator_count, denominator_count, rate,
  gap_pp, status,          -- failing | at_risk | on_track
  opportunity_flag,        -- CLOSEABLE | NEGOTIATE
  opportunity_dollars,
  cms_star_impact,         -- pp distance to next CMS star tier for this measure
  clinical_actions_json,   -- cached from nightly LLM generation
  computed_at, measurement_period_start, measurement_period_end
)

chat_sessions (id, user_id, created_at)
chat_messages (id, session_id, role, content, created_at)
```

### 8.3 File Storage
- Azure Blob Storage: raw PDFs, immutable, versioned
- Naming: `contracts/{contract_id}/{upload_timestamp}_{original_filename}.pdf`

### 8.4 Cache
- Azure Cache for Redis: EHR metric computation results (TTL: 24h)
- Invalidated on manual EHR sync trigger

---

## 9. Security & Compliance

### 9.1 HIPAA

**The critical question:** Does Averin Insight handle PHI?

The answer depends on architecture:

| Layer | Contains PHI? | Analysis |
|-------|---------------|----------|
| Contract PDFs | No | VBC contracts are payer agreements, not patient records |
| EHR queries | Potentially yes | FHIR queries touch patient records at query time |
| Metric store | **No** — by design | Only aggregated counts and rates are stored |
| Chatbot context | **No** — by design | Only aggregated stats enter LLM |
| Frontend | **No** | No patient identifiers displayed |

**EHR query layer is the HIPAA boundary.** If Averin queries a live production EHR, a Business Associate Agreement (BAA) is required with:
- The hospital (as the Covered Entity)
- Microsoft Azure (BAA already available — Azure is HIPAA-eligible)
- InterSystems IRIS (if hosted by them)

**For development with synthetic Synthea data:** No PHI, no HIPAA obligations. Architecture uses HIPAA-eligible Azure services throughout so that connecting a production EHR is a configuration change, not a redesign.

### 9.2 De-identification Standard
If v1 needs patient-level data for drilling into "which specific patients to intervene on," use HIPAA Safe Harbor de-identification (45 CFR §164.514(b)) — strip the 18 identifiers — before passing any data outside the EHR integration layer.

For v0, this is out of scope. Executives see population-level rates only.

### 9.3 Azure HIPAA-Eligible Services Used
- Azure Blob Storage
- Azure Database for PostgreSQL (with pgvector)
- Azure OpenAI Service (GPT-4o) — **Microsoft has a BAA for Azure OpenAI Service. Confirm before sending any real patient data.**
- Azure Container Apps
- Azure Active Directory

### 9.4 Security Controls
- Encryption at rest (Azure default: AES-256)
- Encryption in transit (TLS 1.2+)
- No patient data in LLM prompts (enforced at API layer)
- Role-based access control (AAD groups)
- Audit logging: all API calls logged to Azure Monitor
- Contract PDFs: access via signed URLs only (SAS tokens, 1-hour expiry)
- Secrets: Azure Key Vault (no credentials in code)

### 9.5 Regulations to Address (beyond HIPAA)
- **HITECH Act:** Extends HIPAA to business associates — covered by BAA
- **21st Century Cures Act:** EHR data interoperability via FHIR — IRIS already compliant
- **State privacy laws:** California CMIA (if CA patients), NY SHIELD Act — review for each target market
- **ONC Health IT Certification:** Not required for v0 analytics tools, but relevant if embedding in clinical workflow
- **SOC 2 Type II:** Required before enterprise hospital sales — plan for this in v1

---

## 10. Frontend

### 10.1 Technology
- **Framework:** Next.js 14+ (React, App Router)
- **UI Library:** Microsoft Fluent UI v9 (aligns with Azure/Microsoft aesthetic, good for enterprise)
- **Styling:** Tailwind CSS (for custom components)
- **Charts:** Recharts or Victory (for trend visualizations in v1)
- **State:** React Query (server state) + Zustand (UI state)

### 10.2 Pages / Views (v0)

**Upload Page (`/`)**
- Drag & drop PDF upload zone (multiple files)
- Upload progress indicator
- Extraction status: Queued | Extracting | Review Required | Complete

**Contract Intelligence Dashboard (`/dashboard`)**
- Per-payer cards: payer name, star rating (1–5), potential opportunity ($), failing/at-risk/on-track counts
- Sortable: by opportunity ($), by star rating, by # failing
- Each card expands to show metric table: Measure | Target | Performance | Gap (PP)
- Row color coding: red (failing), amber (at risk), green (on track)
- Click metric row -> drill-down panel

**Metric Drill-Down (slide-over panel)**
- Current Performance: rate + human-readable count ("192 of 770 patients")
- Contract Source: exact extracted text, highlighted
- EHR Data Fields: list of ICD-10, LOINC, CPT codes queried
- Clinical Actions: bullet list of AI-generated interventions
- Measurement period and data freshness timestamp

**Chatbot (global floating widget)**
- "Ask AI" button bottom-right (always visible)
- Opens chat panel
- Suggested prompt chips on open
- Streaming responses
- Conversation history within session

### 10.3 Frontend Edge Cases
- Metrics with missing performance data (EHR sync hasn't run, or measure not computable) — show `—` not 0%, with tooltip explanation
- Metrics where performance exceeds target (green, +gap) — display as positive but still show in table
- Confidence warning: if `extraction_confidence < 0.7`, show warning icon on metric row ("Review extraction")
- Contracts still processing: show spinner in payer card, disable drill-down
- Multiple contracts from same payer (e.g., two contract years) — show latest by default, allow version toggle

---

## 11. EHR Simulation for v0

### 11.1 Synthea Setup
```bash
# Generate synthetic population
java -jar synthea.jar -p 10000 -s 12345 Massachusetts
# Export FHIR R4 bundles
# Load into InterSystems IRIS for Health via FHIR $import operation
```

Configure Synthea modules for relevant conditions:
- Hypertension (prevalence ~30% of adults)
- Diabetes (prevalence ~11%)
- COPD, colorectal cancer screening, breast cancer screening, depression screening

### 11.2 InterSystems IRIS FHIR Server
- Base URL: `https://{iris-host}/fhir/r4`
- Auth: OAuth 2.0 (SMART on FHIR) or basic auth for dev
- FHIR queries use `_count`, `_include`, date filters for measurement period
- Use FHIR Bulk Data Export (`$export`) for population-level queries (more efficient than per-patient queries)

### 11.3 Metric Query Example (Hypertension BP Control)
```
GET /fhir/r4/Patient?_has:Condition:patient:code=I10
    &_has:Encounter:patient:date=ge2025-01-01
    &_count=1000
    &_include=Patient:condition
    (filter exclusions in post-processing)

GET /fhir/r4/Observation?code=8480-6,8462-4
    &patient={patient_ids}
    &_sort=-date
    &_count=1  (most recent per patient)
```

---

## 12. Infrastructure & Deployment

### 12.1 Deployment
- Docker containers from the start — same image runs locally and in production, no migration needed later
- Single region (East US) — expand to multi-region when onboarding health systems in other geographies
- Azure Container Apps: serverless container hosting, scales to zero when idle (cost-effective for early stage)

### 12.2 Docker Setup
```
averin/
├── backend/
│   ├── Dockerfile          # Python 3.12, FastAPI, uvicorn
│   └── docker-compose.yml  # local dev: api + postgres + redis
├── frontend/
│   └── (deployed to Vercel — no container needed)
```

### 12.3 Resource List
| Resource | Service |
|----------|---------|
| Frontend | Vercel |
| API | Azure Container Apps (FastAPI in Docker) |
| Container registry | Azure Container Registry |
| Database + vectors | Azure Database for PostgreSQL Flexible Server + pgvector |
| File storage | Azure Blob Storage |
| LLM | Azure OpenAI Service (GPT-4o) |
| Document AI | Azure AI Document Intelligence |
| Cache | Azure Cache for Redis |
| Secrets | Azure Key Vault |
| Auth | Azure Active Directory B2C |
| Monitoring | Azure Monitor + Application Insights |

### 12.4 CI/CD
- GitHub Actions
- On push to `main`: build Docker image → push to Azure Container Registry → deploy to Container Apps
- On push to feature branch: run tests only

---

## 13. Repo Structure

**Monorepo.** Simpler to manage, no cross-repo dependency issues, faster to iterate.

```
averin/
├── frontend/          # Next.js app
│   ├── app/
│   ├── components/
│   └── lib/
├── backend/           # FastAPI or Azure Functions
│   ├── api/           # Route handlers
│   ├── extraction/    # Contract PDF -> metrics pipeline
│   ├── ehr/           # FHIR integration layer
│   ├── chatbot/       # RAG + chat logic
│   └── models/        # DB models (SQLAlchemy)
├── infra/             # Azure Bicep or Terraform IaC
├── scripts/           # Synthea setup, data loading
└── tests/
```

Split into separate repos when: (a) different teams own frontend vs. backend, or (b) the EHR integration layer needs stricter access controls for a real production environment.

---

## 14. Federated Learning

**Recommendation: Not for v0, evaluate for v1/v2.**

Federated learning is relevant if:
- You want to compare a hospital's metrics against industry benchmarks without centralizing patient data across health systems
- You are training a custom model on EHR data across multiple institutions

For v0, you are not training ML models — you are running rules-based metric computation within a single health system's data. No federated learning needed.

**When to revisit:** If you add features like "how does your hypertension control rate compare to peer hospitals?" — you'd need either (a) federated queries, (b) aggregated benchmarking data from public sources (CMS Quality Payment Program data is public), or (c) a data consortium agreement.

---

> Open questions have been moved to [open_questions.md](open_questions.md).

---

## 15. Out of Scope (Initial Release)
- Patient-level drill-down / "show me which patients to call" (requires PHI access, HIPAA controls, clinical workflow integration)
- Payer portal API integrations (PDF upload covers the use case for now)
- Multi-tenant isolation (single health system initially)
- Custom model fine-tuning or federated learning
- Offline/on-premise deployment
- Mobile app
