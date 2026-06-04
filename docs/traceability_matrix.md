# Traceability Matrix
**Product:** Averin Health  
**Last Updated:** 2026-06-04  
**Branch:** averin-backend

---

## How to Use
Every requirement maps to code and tests. Before marking a requirement complete:
1. Code must be written and reviewed (header signed off)
2. Tests must pass
3. This matrix must be updated

---

## REQ-001: Contract PDF Upload & Storage
**Requirement:** User can upload a payer contract PDF. System stores it and returns a contract ID.  
**Code:** [backend/api/contracts.py](../backend/api/contracts.py) — `upload_contract()`  
**Tests:** Manual — `curl -X POST /contracts -F file=@contract.pdf`  
**Verification:** Manual  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-002: Contract Text Extraction
**Requirement:** System extracts full text from uploaded PDF using Azure Document Intelligence.  
**Code:** [backend/extraction/pipeline.py](../backend/extraction/pipeline.py) — `extract_text_from_pdf()`  
**Tests:** [tests/test_extraction.py](../tests/test_extraction.py) — `TestAetnaExtraction`, `TestMeridianEdgeCases`  
**Verification:** Integration test  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-003: Metric Extraction from Contract Text
**Requirement:** System extracts every quality metric, target value, operator, and source text from contract using LLM.  
**Code:** [backend/extraction/pipeline.py](../backend/extraction/pipeline.py) — `extract_metrics_with_llm()`  
**Tests:** [tests/test_extraction.py](../tests/test_extraction.py) — all `TestAetnaExtraction` tests  
**Verification:** Integration test  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-004: Metric Name → Performance Key Mapping
**Requirement:** System maps extracted metric names to canonical FHIR performance keys using a data-driven lookup table (not hardcoded).  
**Code:** [backend/ehr/mapping.py](../backend/ehr/mapping.py) — `infer_performance_key()`  
**DB:** [backend/db/migrations/versions/20260604_metric_mappings.py](../backend/db/migrations/versions/20260604_metric_mappings.py)  
**Tests:** Covered implicitly by REQ-007 (gap computation requires correct mapping)  
**Verification:** Manual sync + gap check  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-005: FHIR Metric Computation — BP Control
**Requirement:** System queries IRIS FHIR server for hypertensive patients and computes % with BP <140/90.  
**Code:** [backend/ehr/metrics.py](../backend/ehr/metrics.py) — `bp_control()`  
**Tests:** None yet — pending  
**Verification:** Manual EHR sync + result inspection  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** _______________

---

## REQ-006: FHIR Metric Computation — All 7 Metrics
**Requirement:** System computes rates for: bp_control, diabetes_a1c_control, breast_cancer_screening, colorectal_screening, annual_wellness_visit, depression_screening, ed_utilization.  
**Code:** [backend/ehr/metrics.py](../backend/ehr/metrics.py) — `compute_all()`  
**Tests:** None yet — pending  
**Verification:** Manual EHR sync  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** _______________

---

## REQ-007: Gap Computation Math
**Requirement:** For each metric, system computes gap_pp, status (failing/at_risk/on_track), opportunity_flag (CLOSEABLE/NEGOTIATE), and opportunity_dollars.  
**Code:** [backend/ehr/gaps.py](../backend/ehr/gaps.py) — `compute_gap()`, `compute_status()`, `compute_opportunity_dollars()`  
**Tests:** [tests/test_gap_computation.py](../tests/test_gap_computation.py) — 25 tests  
**Verification:** Unit test  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-008: Gap Persistence to Database
**Requirement:** After EHR sync, computed gaps are written/upserted to performance_gaps table.  
**Code:** [backend/ehr/gaps.py](../backend/ehr/gaps.py) — `run_gap_computation()`  
**Tests:** Manual — `GET /ehr/sync/gaps` after sync  
**Verification:** Manual  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-009: Payer Summary API
**Requirement:** `GET /payers` returns all payers with total opportunity dollars and metric status counts.  
**Code:** [backend/api/payers.py](../backend/api/payers.py) — `list_payers()`  
**Tests:** Manual — `curl /payers`  
**Verification:** Manual  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-010: Metric Drill-Down API
**Requirement:** `GET /payers/{id}/metrics` returns all metrics for a payer with performance and gap data joined.  
**Code:** [backend/api/payers.py](../backend/api/payers.py) — `get_payer_metrics()`  
**Tests:** Manual — `curl /payers/{id}/metrics`  
**Verification:** Manual  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-011: EHR Sync Endpoint
**Requirement:** `POST /ehr/sync` triggers async FHIR metric computation and gap computation in the background.  
**Code:** [backend/api/ehr.py](../backend/api/ehr.py) — `trigger_sync()`  
**Tests:** Manual — `curl -X POST /ehr/sync` + status check  
**Verification:** Manual  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## REQ-012: Extraction Edge Cases
**Requirement:** System correctly handles tiered targets, composite measures, reference-only measures, and quality withhold structures.  
**Code:** [backend/extraction/pipeline.py](../backend/extraction/pipeline.py)  
**Tests:** [tests/test_extraction.py](../tests/test_extraction.py) — `TestMeridianEdgeCases`  
**Verification:** Integration test  
**Reviewer:** Tucker Paron  
**Review Date:** 2026-06-04  
**Sign-off:** Tucker Paron

---

## Pending Requirements (not yet implemented)

| REQ | Requirement | Phase |
|-----|-------------|-------|
| REQ-013 | Chatbot RAG + LLM response | Phase 6 |
| REQ-014 | Frontend wired to FastAPI | Phase 7 |
| REQ-015 | CMS Star Rating integration | Phase 5 |
| REQ-016 | Azure Blob Storage for PDFs | Phase 2 |
| REQ-017 | Auth (Azure AAD) | Phase 8 |
| REQ-018 | Azure deployment | Phase 9 |
