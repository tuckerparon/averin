# Open Questions
**Product:** Averin Health
**Last Updated:** 2026-06-03

---

## Product / Business

1. Is this multi-tenant SaaS (serving multiple hospital systems) or single-hospital for the initial build? This affects the entire auth and data isolation model.
2. Who is the primary buyer — the hospital/health system, or the payer?
3. What VBC contract types are in scope? CMS APMs (ACO REACH, MSSP, CMMI models), commercial payer contracts, Medicaid managed care?
4. How are contracts currently delivered to the hospital? Emailed PDFs, payer portals, physical documents? Are contracts standardized or highly variable?
5. Are financial terms (bonus/penalty per percentage point) always explicit in the contract PDF, or do hospitals need to manually enter them?
6. Will executives want trend data over time (are we improving quarter over quarter?), or just current snapshot initially?
7. How do we reliably match a payer name in a contract PDF (e.g., "UnitedHealth") to their CMS contract ID in the star ratings dataset? Payers often have many plans with different contract IDs.

---

## Technical

8. How often should EHR data refresh? Nightly batch is standard; real-time is possible with FHIR subscriptions but significantly more complex.
9. Measurement period handling — do we compute trailing 12 months always, or honor the contract-specified period (calendar year vs. fiscal year vs. rolling)?
10. Contract versioning — when a payer updates a contract mid-year, do we keep the old version and recompute against it, or replace it?
11. What is the `CLOSEABLE` vs. `NEGOTIATE` threshold? Starting assumption is gap > 30pp triggers `NEGOTIATE`, but population risk adjustment may matter — confirm with public health experts.

---

## Public Health (for domain experts)

12. **HEDIS standardization:** What fraction of real VBC contracts reference HEDIS technical specs by name vs. defining their own measure logic? If most use HEDIS, we can pre-load measure definitions and only extract the target from each contract.
13. **Denominator variability:** For the same measure (e.g., hypertension control), do different payers routinely use different denominator definitions, or is there high standardization across contracts?
14. **Data lag in EHRs:** What is the typical lag between a clinical encounter and the data appearing in a reportable form in the EHR? This affects how we communicate data freshness to users.
15. **Attribution:** How do payers define which patients are attributed to a provider for a given contract? Do hospitals receive an attributed patient list from the payer, or must they derive it themselves?
16. **Exclusion criteria complexity:** How often do clinical exclusion criteria (e.g., "exclude patients on hospice") require clinical judgment vs. being deterministically computable from ICD-10/CPT codes in the EHR?
17. **Clinical actions evidence base:** Is there a standard reference (USPSTF, NCQA improvement guides, ACC/AHA guidelines) for the intervention recommendations we generate per metric? Should we cite sources?
18. **Metric suppression:** Are there standard rules about suppressing a metric when the denominator is below a minimum count (e.g., n < 30)? Is the threshold consistent across contracts or contract-specific?
19. **CLOSEABLE vs. NEGOTIATE threshold:** What gap magnitude and what population risk factors should trigger the `NEGOTIATE` flag rather than `CLOSEABLE`?
