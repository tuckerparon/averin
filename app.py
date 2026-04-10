"""
Averin — AI Value-Based Care Intelligence Platform
Flask backend: contract parsing (Gemini 2.0 Flash) + performance analytics.
Run: python app.py
"""
import io
import json
import os
import re
from datetime import datetime, timedelta

import pandas as pd
import pdfplumber
from google import genai
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()
_gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = Flask(__name__)

TODAY = datetime(2026, 4, 10)
DATA_DIR = "data"
PARSED_CACHE = os.path.join(DATA_DIR, "parsed_contracts.json")

# In-memory store (also persisted to JSON)
parsed_contracts: dict = {}


# ── Persistence ───────────────────────────────────────────────────────────────

def load_cache():
    if os.path.exists(PARSED_CACHE):
        with open(PARSED_CACHE, "r") as f:
            return json.load(f)
    return {}


def save_cache():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PARSED_CACHE, "w") as f:
        json.dump(parsed_contracts, f, indent=2)


# ── Patient data ──────────────────────────────────────────────────────────────

_patients_df = None  # type: pd.DataFrame


def get_patients():
    global _patients_df
    if _patients_df is None:
        path = os.path.join(DATA_DIR, "patients.csv")
        if not os.path.exists(path):
            return None
        _patients_df = pd.read_csv(path)
    return _patients_df


# ── PDF extraction ─────────────────────────────────────────────────────────────

def extract_pdf_text(stream) -> str:
    with pdfplumber.open(stream) as pdf:
        pages = [p.extract_text() or "" for p in pdf.pages]
    return "\n\n".join(pages).strip()


# ── Gemini parsing ─────────────────────────────────────────────────────────────

PARSE_PROMPT = """You are a healthcare contract analyst specializing in value-based care (VBC) for hospital systems.

Analyze this payer contract and extract EVERY quality metric, performance measure, and care gap target.

CONTRACT TEXT:
{contract_text}

Return a JSON array. Each element must have EXACTLY these fields (use JSON null, not the string "null"):

[
  {{
    "metric_name": "Clear descriptive name of the quality measure",
    "category": "One of: Diabetes Management | Cardiovascular | Preventive Screening | Behavioral Health | Medication Adherence | Utilization | Care Coordination",
    "target_value": 75.0,
    "target_operator": ">=",
    "target_display": ">=75%",
    "weight": 0.15,
    "calculation_method": "How this metric is calculated (1–2 sentences)",
    "measurement_period": "Annual",
    "payer_name": "Payer name from the contract header",
    "source_text": "EXACT verbatim quote (1–3 sentences) from the contract defining this metric and its target",
    "source_location": "Section or clause reference if stated (else null)",
    "ehr_field_mapping": "Specific EHR fields / data elements needed — include LOINC codes, ICD-10 codes, CPT codes where applicable",
    "financial_incentive": "Any bonus, penalty, or shared-savings clause tied to this metric (else null)",
    "improvement_actions": "2–3 specific clinical actions providers can take to improve performance on this metric"
  }}
]

Rules:
- target_value must be a number (express percentages as 0–100)
- Extract EVERY measurable performance indicator — be thorough
- source_text must be copied verbatim from the contract
- Return ONLY the JSON array — no markdown fences, no explanation text
"""


def parse_contract_with_gemini(contract_text):
    import time
    prompt = PARSE_PROMPT.format(contract_text=contract_text)
    last_err = None
    for attempt in range(3):
        try:
            response = _gemini.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
            )
            raw = response.text.strip()
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
            return json.loads(raw)
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "quota" in err_str.lower() or "rate" in err_str.lower() or "429" in err_str:
                # Rate-limit: short backoff then retry
                if attempt < 2:
                    time.sleep(20)
                    continue
                # Still failing — surface clear guidance
                raise RuntimeError(
                    "Gemini API quota exceeded. Your API key may lack free-tier quota. "
                    "Please create a new key at https://aistudio.google.com/apikey and "
                    "update the GEMINI_API_KEY in your .env file."
                ) from e
            raise
    raise last_err


# ── Metric → performance key mapping ──────────────────────────────────────────

def infer_performance_key(metric_name: str) -> str:
    n = metric_name.lower()
    if any(k in n for k in ["a1c", "hba1c", "glycemic", "glycated hemoglobin", "diabetes control", "hemoglobin a1"]):
        return "diabetes_a1c_control"
    if any(k in n for k in ["blood pressure control", "bp control", "controlling high blood pressure", "hypertension control"]):
        return "bp_control"
    if any(k in n for k in ["breast cancer", "mammogram", "mammography", "bcs"]):
        return "breast_cancer_screening"
    if any(k in n for k in ["colorectal", "colonoscopy", "colon cancer", "col screen", "crc"]):
        return "colorectal_screening"
    if any(k in n for k in ["cervical", "pap smear", "pap test", "ccs"]):
        return "cervical_screening"
    if any(k in n for k in ["wellness visit", "preventive visit", "awv", "annual visit", "annual wellness"]):
        return "annual_wellness_visit"
    if any(k in n for k in ["depression screen", "phq-9", "phq9", "behavioral health screen", "mental health screen"]):
        return "depression_screening"
    if any(k in n for k in ["medication adherence", "med adherence", "proportion days covered", "pdc"]):
        if any(k in n for k in ["diabetes", "oral hypoglycemic", "insulin", "metformin"]):
            return "med_adherence_diabetes"
        if any(k in n for k in ["hypertension", "antihypertensive", "blood pressure med"]):
            return "med_adherence_hypertension"
        if any(k in n for k in ["statin", "cholesterol"]):
            return "med_adherence_statin"
        return "med_adherence_diabetes"   # fallback
    if any(k in n for k in ["statin", "ldl", "cholesterol therapy", "lipid"]):
        return "statin_therapy"
    if any(k in n for k in ["readmit", "readmission", "30-day", "30 day"]):
        return "readmission_rate"
    if any(k in n for k in ["emergency department", "ed visit", "er visit", "ed util", "avoidable ed"]):
        return "ed_utilization"
    if any(k in n for k in ["tobacco", "smoking", "nicotine", "cessation"]):
        return "tobacco_screening"
    return "unknown"


# ── Performance calculators ───────────────────────────────────────────────────

def _safe_date(series):
    return pd.to_datetime(series, errors="coerce")


def calc_perf(key, df):
    cutoff_1yr  = TODAY - timedelta(days=365)
    cutoff_2yr  = TODAY - timedelta(days=730)
    cutoff_3yr  = TODAY - timedelta(days=1095)
    cutoff_10yr = TODAY - timedelta(days=3650)

    try:
        if key == "diabetes_a1c_control":
            elig = df[df["diabetes_status"] == True].copy()
            elig = elig[_safe_date(elig["a1c_date"]) >= cutoff_1yr]
            if elig.empty:
                return None
            num = (elig["a1c_value"] < 8.0).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} diabetic patients have most-recent A1c <8%"}

        if key == "bp_control":
            elig = df[df["hypertension_status"] == True].copy()
            elig = elig[_safe_date(elig["bp_date"]) >= cutoff_1yr]
            if elig.empty:
                return None
            num = ((elig["systolic_bp"] < 140) & (elig["diastolic_bp"] < 90)).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} hypertensive patients with BP <140/90"}

        if key == "breast_cancer_screening":
            elig = df[(df["gender"] == "F") & (df["age"] >= 50) & (df["age"] <= 74)]
            if elig.empty:
                return None
            num = (_safe_date(elig["mammogram_date"]) >= cutoff_2yr).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} eligible women (50–74) with mammogram in last 2 years"}

        if key == "colorectal_screening":
            elig = df[(df["age"] >= 50) & (df["age"] <= 75)]
            if elig.empty:
                return None
            num = (_safe_date(elig["colorectal_screening_date"]) >= cutoff_10yr).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} eligible patients (50–75) with colorectal screening in 10 years"}

        if key == "cervical_screening":
            elig = df[(df["gender"] == "F") & (df["age"] >= 21) & (df["age"] <= 64)]
            if elig.empty:
                return None
            num = (_safe_date(elig["cervical_screening_date"]) >= cutoff_3yr).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} eligible women (21–64) with Pap smear in last 3 years"}

        if key == "annual_wellness_visit":
            num = (_safe_date(df["annual_wellness_visit_date"]) >= cutoff_1yr).sum()
            den = len(df)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} patients completed Annual Wellness Visit in last year"}

        if key == "depression_screening":
            num = (_safe_date(df["depression_screening_date"]) >= cutoff_1yr).sum()
            den = len(df)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} patients with PHQ-9 depression screening in last year"}

        if key == "med_adherence_diabetes":
            elig = df[df["diabetes_med_adherence_pdc"].notna()]
            if elig.empty:
                return None
            num = (elig["diabetes_med_adherence_pdc"] >= 0.80).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} diabetic patients with diabetes medication PDC ≥80%"}

        if key == "med_adherence_hypertension":
            elig = df[df["hypertension_med_adherence_pdc"].notna()]
            if elig.empty:
                return None
            num = (elig["hypertension_med_adherence_pdc"] >= 0.80).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} hypertensive patients with BP medication PDC ≥80%"}

        if key == "med_adherence_statin":
            elig = df[df["statin_med_adherence_pdc"].notna()]
            if elig.empty:
                return None
            num = (elig["statin_med_adherence_pdc"] >= 0.80).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} statin-eligible patients with PDC ≥80%"}

        if key == "statin_therapy":
            elig = df[df["diabetes_status"] == True]   # statin indicated for diabetics 40–75
            elig = elig[(elig["age"] >= 40) & (elig["age"] <= 75)]
            if elig.empty:
                return None
            num = elig["statin_med_adherence_pdc"].notna().sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} diabetic patients (40–75) on statin therapy"}

        if key == "readmission_rate":
            elig = df[df["hospitalizations_12mo"] > 0]
            if elig.empty:
                return None
            num = (elig["readmitted_30days"] == True).sum()
            den = len(elig)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} hospitalized patients readmitted within 30 days"}

        if key == "ed_utilization":
            num = (df["ed_visits_12mo"] >= 2).sum()
            den = len(df)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} patients had ≥2 ED visits in last 12 months"}

        if key == "tobacco_screening":
            num = (_safe_date(df["tobacco_screening_date"]) >= cutoff_1yr).sum()
            den = len(df)
            return {"current_value": round(num / den * 100, 1), "numerator": int(num), "denominator": den,
                    "unit": "%", "detail": f"{num} of {den} patients with tobacco screening in last year"}

    except Exception as e:
        print(f"[calc_perf] {key}: {e}")

    return None


def metric_status(metric, perf):
    if perf is None:
        return "unknown"
    cur = perf.get("current_value")
    tgt = metric.get("target_value")
    op  = metric.get("target_operator", ">=")
    if cur is None or tgt is None:
        return "unknown"
    if op in [">=", ">"]:
        pct_gap = (tgt - cur) / max(tgt, 0.01) * 100
        if cur >= tgt:
            return "green"
        return "yellow" if pct_gap <= 10 else "red"
    else:   # <= or < (lower is better)
        pct_over = (cur - tgt) / max(tgt, 0.01) * 100
        if cur <= tgt:
            return "green"
        return "yellow" if pct_over <= 15 else "red"


def estimate_gap(metric, perf):
    if perf is None:
        return None
    cur = perf.get("current_value")
    tgt = metric.get("target_value")
    op  = metric.get("target_operator", ">=")
    if cur is None or tgt is None:
        return None
    if op in [">=", ">"]:
        return round(cur - tgt, 1)
    return round(tgt - cur, 1)


def star_rating(metrics_with_perf):
    scored, weights = [], []
    for m in metrics_with_perf:
        p = m.get("current_performance")
        if not p:
            continue
        cur = p.get("current_value")
        tgt = m.get("target_value")
        op  = m.get("target_operator", ">=")
        w   = m.get("weight") or 1.0
        if cur is None or tgt is None:
            continue
        if op in [">=", ">"]:
            ach = min(cur / tgt, 1.0) if tgt else 0
        else:
            ach = min(tgt / cur, 1.0) if cur else 1.0
        scored.append(ach * w)
        weights.append(w)
    if not weights:
        return 3.5
    overall = sum(scored) / sum(weights)
    thresholds = [(0.90, 5.0), (0.80, 4.5), (0.70, 4.0), (0.60, 3.5), (0.48, 3.0), (0.36, 2.5)]
    for threshold, rating in thresholds:
        if overall >= threshold:
            return rating
    return 2.0


def financial_opportunity(current_stars: float, red_count: int, yellow_count: int) -> dict:
    """Rough estimate for a small-mid hospital (~800 MA patients in VBC contracts)."""
    MA_PATIENTS = 800
    BONUS_PER_MEMBER = 120   # $/member/year bonus for reaching 4+ stars
    CARE_GAP_SAVINGS = 16_000  # estimated shared savings per closed red gap

    if current_stars < 4.0:
        star_bonus = MA_PATIENTS * BONUS_PER_MEMBER
    elif current_stars < 4.5:
        star_bonus = MA_PATIENTS * 55
    else:
        star_bonus = 0

    gap_savings = (red_count * CARE_GAP_SAVINGS) + (yellow_count * CARE_GAP_SAVINGS * 0.4)
    total = int(star_bonus + gap_savings)
    new_stars = min(5.0, round(current_stars + 0.5, 1))

    return {
        "current_stars": current_stars,
        "potential_stars": new_stars,
        "total_opportunity": total,
        "star_bonus": int(star_bonus),
        "gap_savings": int(gap_savings),
        "ma_patients_assumed": MA_PATIENTS,
    }


# ── Chat context builder ──────────────────────────────────────────────────────

def build_chat_context():
    df = get_patients()
    lines = []

    if df is not None:
        total = len(df)
        lines.append("PATIENT POPULATION SUMMARY:")
        lines.append(f"  Total patients in VBC contracts: {total:,}")
        ins_counts = df["insurance_type"].value_counts()
        for ins, ct in ins_counts.items():
            lines.append(f"  {ins}: {ct:,} ({ct/total*100:.1f}%)")
        dm = df["diabetes_status"].sum()
        htn = df["hypertension_status"].sum()
        dep = df["depression_diagnosis"].sum()
        lines.append(f"  Diabetes: {dm} ({dm/total*100:.1f}%)  |  Hypertension: {htn} ({htn/total*100:.1f}%)  |  Depression: {dep} ({dep/total*100:.1f}%)")

    if not parsed_contracts:
        lines.append("\nNo contracts have been parsed yet.")
        return "\n".join(lines)

    lines.append("\nPARSED CONTRACTS & CURRENT PERFORMANCE:")
    for payer, contract in parsed_contracts.items():
        metrics = contract.get("metrics", [])
        lines.append(f"\n  Payer: {payer}")
        enriched_stars = []
        for m in metrics:
            perf = calc_perf(m.get("performance_key", "unknown"), df) if df is not None else None
            status = metric_status(m, perf)
            gap = estimate_gap(m, perf)
            cur = perf["current_value"] if perf else "N/A"
            enriched_stars.append({**m, "current_performance": perf})
            tgt_str = m.get("target_display") or (str(m.get("target_value", "")) + "%")
            lines.append(
                f"    - {m.get('metric_name','?')}: current={cur}%, target={tgt_str}, "
                f"status={status}, gap={gap}pp, weight={m.get('weight')}"
            )
        stars = star_rating(enriched_stars)
        lines.append(f"  Estimated Star Rating: {stars}")

    return "\n".join(lines)


CHAT_SYSTEM = """You are Averin Insights™ — an AI assistant embedded in a value-based care analytics platform used by hospital executives.

{context}

Your role: Help medical directors and C-suite executives understand their VBC contract performance, prioritize improvement opportunities, and prepare for payer negotiations.

Guidelines:
- Lead with the most important insight — executives are busy
- Always reference specific numbers, metric names, and gaps from the context above
- Explain clinical concepts in plain business language (these are NOT clinicians)
- When asked about improvement, give 2–3 specific, actionable steps
- When discussing financial impact, be specific about the dollar figures in context
- Be confident, direct, and concise — no filler phrases
- Never fabricate numbers not present in the context
"""


# ── Flask routes ──────────────────────────────────────────────────────────────

# Ensure unhandled exceptions return JSON (not Vercel's HTML error pages)
@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    return jsonify({"error": str(e), "trace": traceback.format_exc()[-500:]}), 500

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": str(e)}), 500


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/payers")
def get_payers():
    return jsonify(
        {
            "payers": [
                {
                    "key": k,
                    "filename": v.get("filename", ""),
                    "metric_count": len(v.get("metrics", [])),
                    "parsed_at": v.get("parsed_at"),
                }
                for k, v in parsed_contracts.items()
            ]
        }
    )


@app.route("/api/parse-contract", methods=["POST"])
def parse_contract():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Must be a PDF file"}), 400

    # Infer payer key from filename
    name = f.filename.lower()
    if "aetna" in name:
        payer_key = "Aetna"
    elif "humana" in name:
        payer_key = "Humana"
    elif "united" in name:
        payer_key = "UnitedHealth"
    elif "cigna" in name:
        payer_key = "Cigna"
    elif "bcbs" in name or "blue" in name:
        payer_key = "BCBS"
    else:
        payer_key = f.filename.replace(".pdf", "").replace("_", " ").title()

    # Extract PDF text
    pdf_stream = io.BytesIO(f.read())
    try:
        contract_text = extract_pdf_text(pdf_stream)
    except Exception as e:
        return jsonify({"error": f"PDF extraction failed: {e}"}), 500

    if len(contract_text) < 100:
        return jsonify({"error": "Could not extract text — file may be a scanned image PDF"}), 400

    # Parse with Gemini
    try:
        metrics = parse_contract_with_gemini(contract_text)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"AI returned invalid JSON: {e}"}), 500
    except Exception as e:
        return jsonify({"error": f"AI parsing failed: {e}"}), 500

    # Enrich each metric with a performance key
    for m in metrics:
        m["performance_key"] = infer_performance_key(m.get("metric_name", ""))

    parsed_contracts[payer_key] = {
        "payer": payer_key,
        "filename": f.filename,
        "metrics": metrics,
        "parsed_at": datetime.now().isoformat(),
    }
    save_cache()

    return jsonify({"payer": payer_key, "metric_count": len(metrics), "metrics": metrics})


@app.route("/api/performance/<payer>")
def get_performance(payer):
    if payer not in parsed_contracts:
        return jsonify({"error": "Contract not found — parse it first"}), 404

    df = get_patients()
    metrics = parsed_contracts[payer]["metrics"]
    enriched = []

    for m in metrics:
        perf = calc_perf(m.get("performance_key", "unknown"), df) if df is not None else None
        status = metric_status(m, perf)
        gap = estimate_gap(m, perf)
        enriched.append({**m, "current_performance": perf, "status": status, "gap": gap})

    stars = star_rating(enriched)
    red    = sum(1 for m in enriched if m["status"] == "red")
    yellow = sum(1 for m in enriched if m["status"] == "yellow")
    green  = sum(1 for m in enriched if m["status"] == "green")
    fin    = financial_opportunity(stars, red, yellow)

    return jsonify({
        "payer": payer,
        "star_rating": stars,
        "financial": fin,
        "counts": {"red": red, "yellow": yellow, "green": green},
        "metrics": enriched,
    })


@app.route("/api/chat", methods=["POST"])
def chat():
    import time
    body    = request.json or {}
    message = body.get("message", "").strip()
    history = body.get("history", [])

    if not message:
        return jsonify({"error": "No message provided"}), 400

    context     = build_chat_context()
    system_text = CHAT_SYSTEM.format(context=context)

    # Build conversation prompt including history
    conversation = []
    for h in history[-8:]:
        role   = "Executive" if h.get("role") == "user" else "Averin AI"
        conversation.append(f"{role}: {h.get('content', '')}")
    conversation.append(f"Executive: {message}")
    conversation.append("Averin AI:")

    full_prompt = system_text + "\n\n--- CONVERSATION ---\n" + "\n".join(conversation)

    try:
        response = _gemini.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt,
        )
        return jsonify({"response": response.text.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parsed_contracts.update(load_cache())
    print("Averin running → http://localhost:5001")
    app.run(debug=True, host="0.0.0.0", port=5001)
