"""
FHIR metric computation engine.

Each function returns:
  {rate, numerator_count, denominator_count, as_of_date}

Only aggregated counts leave this module — no patient IDs upstream.
"""

from datetime import date, timedelta
from .fhir_client import get_all_pages

MEASUREMENT_YEAR = date.today().year
PERIOD_START = f"{MEASUREMENT_YEAR}-01-01"
PERIOD_END = f"{MEASUREMENT_YEAR}-12-31"


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator * 100, 2) if denominator else None


def _dob_cutoff(min_age: int, max_age: int) -> tuple[str, str]:
    today = date.today()
    return (
        str(today.replace(year=today.year - max_age)),
        str(today.replace(year=today.year - min_age)),
    )


async def bp_control() -> dict:
    """Hypertension: BP Control (<140/90). HEDIS CBP. ICD-10: I10. LOINC: 8480-6, 8462-4."""
    patients = await get_all_pages("Patient", {
        "_has:Condition:patient:code": "I10",
        "birthdate": f"ge{_dob_cutoff(18, 85)[0]}",
    })
    denominator = len(patients)
    if not denominator:
        return {"rate": None, "numerator_count": 0, "denominator_count": 0}

    patient_ids = ",".join(p["id"] for p in patients)
    observations = await get_all_pages("Observation", {
        "code": "8480-6,8462-4",
        "patient": patient_ids,
        "date": f"ge{PERIOD_START}",
        "_sort": "-date",
    })

    # Group most recent systolic + diastolic per patient
    systolic: dict[str, float] = {}
    diastolic: dict[str, float] = {}
    for obs in observations:
        pid = obs.get("subject", {}).get("reference", "").split("/")[-1]
        code = obs.get("code", {}).get("coding", [{}])[0].get("code", "")
        value = obs.get("valueQuantity", {}).get("value")
        if value is None:
            continue
        if code == "8480-6" and pid not in systolic:
            systolic[pid] = value
        elif code == "8462-4" and pid not in diastolic:
            diastolic[pid] = value

    numerator = sum(
        1 for pid in patients
        if systolic.get(pid["id"], 999) < 140 and diastolic.get(pid["id"], 999) < 90
    )
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def diabetes_a1c_control() -> dict:
    """Diabetes: A1C Control (<8%). HEDIS HbA1c. ICD-10: E11. LOINC: 4548-4."""
    patients = await get_all_pages("Patient", {"_has:Condition:patient:code": "E11"})
    denominator = len(patients)
    if not denominator:
        return {"rate": None, "numerator_count": 0, "denominator_count": 0}

    patient_ids = ",".join(p["id"] for p in patients)
    observations = await get_all_pages("Observation", {
        "code": "4548-4",
        "patient": patient_ids,
        "date": f"ge{PERIOD_START}",
        "_sort": "-date",
    })

    latest_a1c: dict[str, float] = {}
    for obs in observations:
        pid = obs.get("subject", {}).get("reference", "").split("/")[-1]
        value = obs.get("valueQuantity", {}).get("value")
        if value is not None and pid not in latest_a1c:
            latest_a1c[pid] = value

    numerator = sum(1 for pid in patients if latest_a1c.get(pid["id"], 999) < 8.0)
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def breast_cancer_screening() -> dict:
    """Breast cancer screening. HEDIS BCS. Women 50-74. CPT: 77067."""
    dob_min, dob_max = _dob_cutoff(50, 74)
    patients = await get_all_pages("Patient", {
        "gender": "female",
        "birthdate": f"ge{dob_min}&birthdate=le{dob_max}",
    })
    denominator = len(patients)
    if not denominator:
        return {"rate": None, "numerator_count": 0, "denominator_count": 0}

    patient_ids = ",".join(p["id"] for p in patients)
    procedures = await get_all_pages("Procedure", {
        "code": "77067",
        "patient": patient_ids,
        "date": f"ge{PERIOD_START}",
    })
    screened = {p.get("subject", {}).get("reference", "").split("/")[-1] for p in procedures}
    numerator = sum(1 for p in patients if p["id"] in screened)
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def colorectal_screening() -> dict:
    """Colorectal cancer screening. HEDIS COL. Ages 45-75. CPT: 45378."""
    dob_min, dob_max = _dob_cutoff(45, 75)
    patients = await get_all_pages("Patient", {
        "birthdate": f"ge{dob_min}&birthdate=le{dob_max}",
    })
    denominator = len(patients)
    if not denominator:
        return {"rate": None, "numerator_count": 0, "denominator_count": 0}

    patient_ids = ",".join(p["id"] for p in patients)
    procedures = await get_all_pages("Procedure", {
        "code": "45378",
        "patient": patient_ids,
        "date": f"ge{date.today().replace(year=date.today().year - 10)}",
    })
    screened = {p.get("subject", {}).get("reference", "").split("/")[-1] for p in procedures}
    numerator = sum(1 for p in patients if p["id"] in screened)
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def annual_wellness_visit() -> dict:
    """Annual Wellness Visit. CPT: G0438, G0439."""
    encounters = await get_all_pages("Encounter", {
        "type": "G0438,G0439",
        "date": f"ge{PERIOD_START}",
    })
    patients_with_awv = {
        e.get("subject", {}).get("reference", "").split("/")[-1] for e in encounters
    }
    all_patients = await get_all_pages("Patient", {})
    denominator = len(all_patients)
    numerator = sum(1 for p in all_patients if p["id"] in patients_with_awv)
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def depression_screening() -> dict:
    """Depression screening. HEDIS DSF. PHQ-9. LOINC: 44249-1."""
    observations = await get_all_pages("Observation", {
        "code": "44249-1",
        "date": f"ge{PERIOD_START}",
    })
    screened = {
        o.get("subject", {}).get("reference", "").split("/")[-1] for o in observations
    }
    all_patients = await get_all_pages("Patient", {})
    denominator = len(all_patients)
    numerator = sum(1 for p in all_patients if p["id"] in screened)
    return {"rate": _rate(numerator, denominator), "numerator_count": numerator, "denominator_count": denominator}


async def ed_utilization() -> dict:
    """ED utilization rate per 1000 members. Emergency encounters."""
    ed_encounters = await get_all_pages("Encounter", {
        "class": "EMER",
        "date": f"ge{PERIOD_START}",
    })
    all_patients = await get_all_pages("Patient", {})
    denominator = len(all_patients)
    numerator = len(ed_encounters)
    rate = round(numerator / denominator * 1000, 1) if denominator else None
    return {"rate": rate, "numerator_count": numerator, "denominator_count": denominator}


# Registry — maps metric key to compute function
METRIC_REGISTRY = {
    "bp_control": bp_control,
    "diabetes_a1c_control": diabetes_a1c_control,
    "breast_cancer_screening": breast_cancer_screening,
    "colorectal_screening": colorectal_screening,
    "annual_wellness_visit": annual_wellness_visit,
    "depression_screening": depression_screening,
    "ed_utilization": ed_utilization,
}


async def compute_all() -> dict[str, dict]:
    """Run all metrics and return results keyed by metric name."""
    results = {}
    for key, fn in METRIC_REGISTRY.items():
        try:
            results[key] = await fn()
        except Exception as e:
            results[key] = {"error": str(e), "rate": None, "numerator_count": 0, "denominator_count": 0}
    return results
