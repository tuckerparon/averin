"""
Generates a realistic simulated EHR patient dataset for a small-mid size hospital system.
Profile: ~300-bed Midwest hospital, 3,000 patients in VBC contracts.
Run once: python generate_data.py
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random
import os

np.random.seed(42)
random.seed(42)

TODAY = datetime(2026, 4, 10)
N = 3000


def random_date(start_days_ago: int, end_days_ago: int) -> str:
    days = random.randint(start_days_ago, end_days_ago)
    return (TODAY - timedelta(days=days)).strftime("%Y-%m-%d")


def maybe_date(probability: float, start_days_ago: int, end_days_ago: int):
    if random.random() < probability:
        return random_date(start_days_ago, end_days_ago)
    return None


# ── Demographics ──────────────────────────────────────────────────────────────

patient_ids = [f"PT{str(i).zfill(5)}" for i in range(1, N + 1)]

# Age: skewed older — VBC populations tend toward Medicare
age_segments = [
    (int(N * 0.15), 18,  40),   # young adults / Medicaid
    (int(N * 0.30), 40,  58),   # middle-age commercial/Medicaid
    (int(N * 0.38), 58,  75),   # core Medicare
    (int(N * 0.17), 75,  90),   # older Medicare
]
ages_list = []
for count, lo, hi in age_segments:
    ages_list.extend(np.random.randint(lo, hi, size=count).tolist())
while len(ages_list) < N:
    ages_list.append(random.randint(58, 75))
random.shuffle(ages_list)
ages = np.array(ages_list[:N])

genders = np.random.choice(["F", "M"], size=N, p=[0.53, 0.47])

ethnicities = np.random.choice(
    ["White", "Black/African American", "Hispanic/Latino", "Asian", "Other/Unknown"],
    size=N,
    p=[0.56, 0.21, 0.14, 0.05, 0.04],
)

# Insurance type (age-driven)
insurance_types = []
for age in ages:
    if age >= 65:
        insurance_types.append(
            np.random.choice(["Medicare Advantage", "Traditional Medicare"], p=[0.62, 0.38])
        )
    elif age >= 50:
        insurance_types.append(
            np.random.choice(
                ["Commercial", "Medicare Advantage", "Medicaid"], p=[0.50, 0.20, 0.30]
            )
        )
    else:
        insurance_types.append(
            np.random.choice(["Commercial", "Medicaid", "Marketplace ACA"], p=[0.50, 0.35, 0.15])
        )

# Zip codes (fictionalized Midwest/Indiana area)
zip_codes = np.random.choice(
    ["47401", "47403", "47404", "47408", "47420", "47441", "47462", "47456", "47468", "47406"],
    size=N,
)

# ── Chronic conditions ────────────────────────────────────────────────────────

diabetes_status = []
hypertension_status = []
depression_diagnosis = []
ckd_status = []
chf_status = []
copd_status = []

for i, (age, gender, ethnicity) in enumerate(zip(ages, genders, ethnicities)):
    # Diabetes — Midwest prevalence ~14%, higher with age and in Black/Hispanic populations
    dm_p = 0.055 + (max(0, age - 30)) * 0.0045
    if ethnicity in ["Black/African American", "Hispanic/Latino"]:
        dm_p *= 1.35
    dm_p = min(dm_p, 0.42)
    diabetes_status.append(random.random() < dm_p)

    # Hypertension — national average ~33%; higher in Black patients and with age
    htn_p = 0.12 + (max(0, age - 25)) * 0.0055
    if ethnicity == "Black/African American":
        htn_p *= 1.40
    htn_p = min(htn_p, 0.70)
    hypertension_status.append(random.random() < htn_p)

    # Depression — higher in women, working-age adults
    dep_p = 0.14 if gender == "M" else 0.19
    if 25 <= age <= 60:
        dep_p *= 1.25
    dep_p = min(dep_p, 0.35)
    depression_diagnosis.append(random.random() < dep_p)

    # CKD — strongly associated with diabetes and age
    ckd_p = 0.03 + (max(0, age - 45)) * 0.003
    if diabetes_status[-1]:
        ckd_p *= 2.2
    ckd_p = min(ckd_p, 0.28)
    ckd_status.append(random.random() < ckd_p)

    # CHF — age-driven
    chf_p = 0.01 + (max(0, age - 55)) * 0.004
    chf_p = min(chf_p, 0.20)
    chf_status.append(random.random() < chf_p)

    # COPD — higher in smokers / older adults
    copd_p = 0.04 + (max(0, age - 50)) * 0.003
    copd_p = min(copd_p, 0.18)
    copd_status.append(random.random() < copd_p)

# ── Clinical lab values ───────────────────────────────────────────────────────

# HbA1c — only meaningful for diabetics, but we record for pre-diabetics too
a1c_values, a1c_dates = [], []
for i, is_dm in enumerate(diabetes_status):
    if is_dm:
        # Mean ~7.8, SD 1.6 — realistic mid-performer
        a1c = max(5.5, min(15.0, np.random.normal(7.8, 1.6)))
        a1c_values.append(round(a1c, 1))
        # ~80% have test in past year, 12% between 1-2 years, 8% older/missing
        r = random.random()
        if r < 0.80:
            a1c_dates.append(random_date(0, 365))
        elif r < 0.92:
            a1c_dates.append(random_date(366, 730))
        else:
            a1c_dates.append(None)
    else:
        a1c_values.append(None)
        a1c_dates.append(None)

# Blood pressure — for all patients
systolic_values, diastolic_values, bp_dates = [], [], []
for i, is_htn in enumerate(hypertension_status):
    if is_htn:
        # Hypertensive patients: many are uncontrolled
        sys = max(110, min(210, np.random.normal(143, 22)))
        dia = max(60, min(120, np.random.normal(86, 13)))
    else:
        sys = max(95, min(148, np.random.normal(118, 12)))
        dia = max(55, min(90, np.random.normal(76, 8)))
    systolic_values.append(int(round(sys)))
    diastolic_values.append(int(round(dia)))
    r = random.random()
    if r < 0.76:
        bp_dates.append(random_date(0, 365))
    elif r < 0.90:
        bp_dates.append(random_date(366, 730))
    else:
        bp_dates.append(None)

# LDL cholesterol
ldl_values, ldl_dates = [], []
for i in range(N):
    ldl = max(40, min(260, np.random.normal(112, 38)))
    ldl_values.append(int(round(ldl)))
    if random.random() < 0.65:
        ldl_dates.append(random_date(0, 365))
    else:
        ldl_dates.append(None)

# BMI
bmis = []
for gender in genders:
    base = 30.2 if gender == "F" else 29.6
    bmi = max(16.0, min(58.0, np.random.normal(base, 7.2)))
    bmis.append(round(bmi, 1))

# eGFR (renal function)
egfr_values = []
for i, has_ckd in enumerate(ckd_status):
    if has_ckd:
        egfr = max(10, min(59, np.random.normal(42, 12)))
    else:
        egfr = max(60, min(120, np.random.normal(84, 15)))
    egfr_values.append(int(round(egfr)))

# ── Preventive screenings ─────────────────────────────────────────────────────

# Mammogram — women 50–74 (HEDIS BCS measure)
mammogram_dates = []
for i, (gender, age) in enumerate(zip(genders, ages)):
    if gender == "F" and 50 <= age <= 74:
        r = random.random()
        if r < 0.54:        # ~54% compliant (within 27 months per HEDIS)
            mammogram_dates.append(random_date(0, 820))
        elif r < 0.68:
            mammogram_dates.append(random_date(821, 1460))
        else:
            mammogram_dates.append(None)
    else:
        mammogram_dates.append(None)

# Colorectal cancer screening — ages 50–75 (colonoscopy ≤10 yrs, FIT ≤1 yr, CT ≤5 yrs)
colorectal_screening_dates = []
for i, age in enumerate(ages):
    if 50 <= age <= 75:
        r = random.random()
        if r < 0.48:
            colorectal_screening_dates.append(random_date(0, 3650))
        elif r < 0.60:
            colorectal_screening_dates.append(random_date(3651, 5475))
        else:
            colorectal_screening_dates.append(None)
    else:
        colorectal_screening_dates.append(None)

# Annual Wellness Visit (Medicare AWV) — used as proxy for preventive visit
awv_dates = []
for i in range(N):
    r = random.random()
    if r < 0.41:
        awv_dates.append(random_date(0, 365))
    elif r < 0.58:
        awv_dates.append(random_date(366, 730))
    else:
        awv_dates.append(None)

# Last office visit
last_visit_dates = []
for i in range(N):
    r = random.random()
    if r < 0.68:
        last_visit_dates.append(random_date(0, 180))
    elif r < 0.88:
        last_visit_dates.append(random_date(181, 365))
    else:
        last_visit_dates.append(random_date(366, 730))

# Depression screening (PHQ-9)
depression_screening_dates, depression_screening_scores = [], []
for i, has_dep in enumerate(depression_diagnosis):
    if random.random() < 0.62:
        depression_screening_dates.append(random_date(0, 365))
        score = random.randint(8, 24) if has_dep else random.randint(0, 7)
        depression_screening_scores.append(score)
    else:
        depression_screening_dates.append(None)
        depression_screening_scores.append(None)

# Cervical cancer screening — women 21–64 (Pap smear ≤3 yrs)
cervical_screening_dates = []
for i, (gender, age) in enumerate(zip(genders, ages)):
    if gender == "F" and 21 <= age <= 64:
        r = random.random()
        if r < 0.58:
            cervical_screening_dates.append(random_date(0, 1095))
        elif r < 0.72:
            cervical_screening_dates.append(random_date(1096, 1825))
        else:
            cervical_screening_dates.append(None)
    else:
        cervical_screening_dates.append(None)

# ── Utilization ───────────────────────────────────────────────────────────────

ed_visits_12mo = np.random.choice(
    [0, 1, 2, 3, 4, 5, 6], size=N, p=[0.54, 0.25, 0.11, 0.05, 0.03, 0.015, 0.005]
)

hospitalizations_12mo = np.random.choice(
    [0, 1, 2, 3, 4], size=N, p=[0.77, 0.16, 0.05, 0.015, 0.005]
)

readmitted_30days = [
    (random.random() < 0.138) if h > 0 else False
    for h in hospitalizations_12mo
]

# ── Medication adherence (PDC — Proportion Days Covered) ─────────────────────

diabetes_med_pdc = []
for is_dm in diabetes_status:
    if is_dm:
        # Beta distribution: mean ~0.73, some non-adherent tail
        pdc = max(0.0, min(1.0, np.random.beta(5.5, 2.2)))
        diabetes_med_pdc.append(round(pdc, 3))
    else:
        diabetes_med_pdc.append(None)

hypertension_med_pdc = []
for is_htn in hypertension_status:
    if is_htn:
        pdc = max(0.0, min(1.0, np.random.beta(5.2, 2.4)))
        hypertension_med_pdc.append(round(pdc, 3))
    else:
        hypertension_med_pdc.append(None)

statin_pdc = []
for i in range(N):
    # Statins prescribed for ~55% of panel (diabetes, high LDL, CV risk)
    eligible = diabetes_status[i] or ldl_values[i] > 130 or ages[i] > 60
    if eligible and random.random() < 0.70:
        pdc = max(0.0, min(1.0, np.random.beta(5.0, 2.5)))
        statin_pdc.append(round(pdc, 3))
    else:
        statin_pdc.append(None)

# ── Tobacco ───────────────────────────────────────────────────────────────────

tobacco_status = []
for age in ages:
    # Midwest smoking rate ~18%; former smokers more common in older cohort
    if age >= 55:
        s = np.random.choice(["Current", "Former", "Never"], p=[0.17, 0.38, 0.45])
    else:
        s = np.random.choice(["Current", "Former", "Never"], p=[0.19, 0.18, 0.63])
    tobacco_status.append(s)

tobacco_screening_dates = [
    maybe_date(0.71, 0, 365) for _ in range(N)
]

# ── Primary diagnosis (ICD-10) ────────────────────────────────────────────────

icd10_primary = []
for i in range(N):
    if diabetes_status[i] and hypertension_status[i]:
        icd10_primary.append(random.choice(["E11.9", "I10", "E11.65"]))
    elif diabetes_status[i]:
        icd10_primary.append(random.choice(["E11.9", "E11.65", "E11.40"]))
    elif hypertension_status[i]:
        icd10_primary.append(random.choice(["I10", "I11.9"]))
    elif chf_status[i]:
        icd10_primary.append(random.choice(["I50.32", "I50.22"]))
    elif copd_status[i]:
        icd10_primary.append(random.choice(["J44.1", "J44.0"]))
    elif depression_diagnosis[i]:
        icd10_primary.append(random.choice(["F32.1", "F33.1"]))
    else:
        icd10_primary.append(
            random.choice(["Z00.00", "E78.5", "M54.5", "K21.0", "G43.909", "Z87.891"])
        )

# ── Build DataFrame ───────────────────────────────────────────────────────────

df = pd.DataFrame(
    {
        "patient_id": patient_ids,
        "age": ages,
        "gender": genders,
        "ethnicity": ethnicities,
        "insurance_type": insurance_types,
        "zip_code": zip_codes,
        "primary_diagnosis_icd10": icd10_primary,
        # Chronic conditions
        "diabetes_status": diabetes_status,
        "hypertension_status": hypertension_status,
        "depression_diagnosis": depression_diagnosis,
        "ckd_status": ckd_status,
        "chf_status": chf_status,
        "copd_status": copd_status,
        # Lab values
        "a1c_value": a1c_values,
        "a1c_date": a1c_dates,
        "systolic_bp": systolic_values,
        "diastolic_bp": diastolic_values,
        "bp_date": bp_dates,
        "ldl_value": ldl_values,
        "ldl_date": ldl_dates,
        "egfr_value": egfr_values,
        "bmi": bmis,
        # Preventive screenings
        "mammogram_date": mammogram_dates,
        "colorectal_screening_date": colorectal_screening_dates,
        "cervical_screening_date": cervical_screening_dates,
        "annual_wellness_visit_date": awv_dates,
        "last_visit_date": last_visit_dates,
        # Behavioral health
        "depression_screening_date": depression_screening_dates,
        "depression_screening_score": depression_screening_scores,
        # Tobacco
        "tobacco_status": tobacco_status,
        "tobacco_screening_date": tobacco_screening_dates,
        # Utilization
        "ed_visits_12mo": ed_visits_12mo,
        "hospitalizations_12mo": hospitalizations_12mo,
        "readmitted_30days": readmitted_30days,
        # Medication adherence
        "diabetes_med_adherence_pdc": diabetes_med_pdc,
        "hypertension_med_adherence_pdc": hypertension_med_pdc,
        "statin_med_adherence_pdc": statin_pdc,
    }
)

os.makedirs("data", exist_ok=True)
df.to_csv("data/patients.csv", index=False)

print(f"✓ Generated {N:,} patient records → data/patients.csv")
print()
print("── Population Profile ──────────────────────────────────")
print(f"  Diabetes:          {sum(diabetes_status):>5,}  ({sum(diabetes_status)/N*100:4.1f}%)")
print(f"  Hypertension:      {sum(hypertension_status):>5,}  ({sum(hypertension_status)/N*100:4.1f}%)")
print(f"  Depression:        {sum(depression_diagnosis):>5,}  ({sum(depression_diagnosis)/N*100:4.1f}%)")
print(f"  CKD:               {sum(ckd_status):>5,}  ({sum(ckd_status)/N*100:4.1f}%)")
print(f"  CHF:               {sum(chf_status):>5,}  ({sum(chf_status)/N*100:4.1f}%)")
print()
print("── Insurance Mix ───────────────────────────────────────")
for ins in ["Medicare Advantage", "Traditional Medicare", "Commercial", "Medicaid", "Marketplace ACA"]:
    ct = insurance_types.count(ins)
    print(f"  {ins:<25}  {ct:>5,}  ({ct/N*100:4.1f}%)")
print()
print("── Performance Snapshot ────────────────────────────────")
dm_pts = sum(diabetes_status)
if dm_pts:
    a1c_ctrl = sum(1 for i in range(N) if diabetes_status[i] and a1c_values[i] is not None and a1c_values[i] < 8.0)
    print(f"  Diabetes A1c <8%:        {a1c_ctrl/dm_pts*100:5.1f}%")
htn_pts = sum(hypertension_status)
if htn_pts:
    bp_ctrl = sum(
        1 for i in range(N)
        if hypertension_status[i] and systolic_values[i] < 140 and diastolic_values[i] < 90
    )
    print(f"  BP control (<140/90):    {bp_ctrl/htn_pts*100:5.1f}%")
f_50_74 = [i for i in range(N) if genders[i] == "F" and 50 <= ages[i] <= 74]
if f_50_74:
    mam_ct = sum(1 for i in f_50_74 if mammogram_dates[i] is not None)
    print(f"  Breast cancer screen:    {mam_ct/len(f_50_74)*100:5.1f}%")
awv_ct = sum(1 for d in awv_dates if d is not None)
print(f"  Annual wellness visit:   {awv_ct/N*100:5.1f}%")
depr_ct = sum(1 for d in depression_screening_dates if d is not None)
print(f"  Depression screening:    {depr_ct/N*100:5.1f}%")
hosp = sum(1 for h in hospitalizations_12mo if h > 0)
if hosp:
    readm = sum(1 for r in readmitted_30days if r)
    print(f"  30-day readmission:      {readm/hosp*100:5.1f}%")
