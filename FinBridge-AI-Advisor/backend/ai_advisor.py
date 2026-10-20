
"""
FinBridge AI Study Abroad Finance Advisor
File: backend/ai_advisor.py

Endpoints:
  GET  /api/health
  POST /api/ai-advisor

Required backend/.env:
  GEMINI_API_KEY=your_real_key
  GEMINI_MODEL=gemini-3.8-flash

Install dependencies:
  pip install flask flask-cors python-dotenv
"""

import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS


# =========================================================
# CONFIGURATION
# =========================================================

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env", override=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("FinBridge")

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()

try:
    API_TIMEOUT_SECONDS = max(
        15, min(180, int(os.getenv("GEMINI_TIMEOUT_SECONDS", "90")))
    )
except ValueError:
    API_TIMEOUT_SECONDS = 90

try:
    MAX_OUTPUT_TOKENS = max(
        512, min(8192, int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1800")))
    )
except ValueError:
    MAX_OUTPUT_TOKENS = 1800

PLACEHOLDER_KEYS = {
    "",
    "your_gemini_api_key_here",
    "your_api_key_here",
    "paste_api_key_here",
    "your_actual_api_key",
    "your_real_key",
}

MOCK_MODE = API_KEY.lower() in PLACEHOLDER_KEYS

if not re.fullmatch(r"[A-Za-z0-9._-]+", MODEL):
    raise RuntimeError("Invalid GEMINI_MODEL value in backend/.env")

frontend_origin = os.getenv("FRONTEND_ORIGIN", "*").strip() or "*"

CORS(
    app,
    resources={
        r"/api/*": {"origins": frontend_origin.split(",")}
    },
)


# =========================================================
# SYSTEM INSTRUCTION
# =========================================================

SYSTEM_INSTRUCTION = """
You are FinBridge, a practical AI study-abroad and student finance advisor.

YOUR PRIMARY GOAL:
Answer the user's actual question accurately, directly, and helpfully.

RESPONSE RULES:

1. Start with the direct answer in the first 1-2 sentences.
2. Do not begin every answer with an introduction, assumptions section,
   or a long list of regulations.
3. Never invent the user's country, city, currency, university, age,
   immigration status, or personal financial situation.
4. If the user has not specified a location, do not assume Toronto,
   Canada, Bangladesh, or any other location.
5. If location is missing, provide a useful general answer first.
   Then ask one brief follow-up question if local details would help.
6. For simple questions, keep the answer short and focused.
   For complex financial planning questions, provide organized details.
7. Match the language of the user's question. Answer in Bangla when
   the user asks in Bangla, and English when they ask in English,
   unless they request a different language.
8. Distinguish user-provided facts from estimates and assumptions.
   Never present an assumption as a confirmed fact.
9. Do not invent live exchange rates, current wages, tuition fees,
   tax rules, scholarship awards, or official immigration requirements.
10. If reliable live information has not been retrieved, clearly state
    that current local figures need verification.
11. When estimating part-time income, explain the hourly wage,
    weekly hours, approximate monthly gross income, and possible
    deductions. Use hypothetical numbers only when clearly labelled.
12. Never guarantee a job, scholarship, visa, income, or investment return.
13. Use financial context only when relevant to the question.
    Do not force a budget calculation into unrelated questions.
14. Treat supplied financial calculations as estimates, not official quotes.
15. If important details are missing, explain the limitation briefly
    rather than refusing to answer an otherwise answerable question.
16. Use readable paragraphs and useful bullet points. Avoid unnecessary
    headings, repetition, and excessively long responses.

For education budgeting, tuition, living costs, savings, funding gaps,
money transfers, and student income, provide realistic guidance with
clear assumptions and practical next steps.

This is educational guidance, not professional financial advice.
""".strip()


# =========================================================
# FINANCIAL CALCULATIONS
# =========================================================

FINANCIAL_FIELDS = {
    "studyDurationMonths",
    "tuitionPerYear",
    "monthlyLiving",
    "initialExpenses",
    "availableFunds",
    "exchangeRate",
}

FINANCIAL_KEYWORDS = (
    "tuition",
    "budget",
    "total cost",
    "funding gap",
    "available funds",
    "savings",
    "afford",
    "living expenses",
    "study cost",
    "education cost",
    "financial plan",
    "how much money",
    "part-time income",
    "part time income",
    "student income",
    "earn per month",
    "monthly income",
    "student job",
)


def is_finance_question(message):
    """Return True when the question concerns financial planning."""
    text = message.lower()
    return any(keyword in text for keyword in FINANCIAL_KEYWORDS)


def calculate_finances(context):
    """
    Calculate an estimate only when financial inputs are supplied.

    exchangeRate means destination-currency units for one
    home-currency unit.

    Example:
      1 BDT = 0.009 CAD means exchangeRate=0.009.

    Missing values use clearly labelled planning assumptions.
    These defaults are not confirmed prices or exchange rates.
    """
    if not isinstance(context, dict):
        raise ValueError("Financial context must be a JSON object.")

    supplied_fields = FINANCIAL_FIELDS.intersection(context.keys())

    # Do not invent a budget when the user supplied no financial inputs.
    if not supplied_fields:
        return {}

    defaults = {
        "studyDurationMonths": 24,
        "tuitionPerYear": 45000,
        "monthlyLiving": 1700,
        "initialExpenses": 4200,
        "availableFunds": 0,
        "exchangeRate": 0.009,
    }

    try:
        values = {}

        for field, default in defaults.items():
            raw_value = context.get(field, default)

            # Reject booleans, strings, NaN and infinite values.
            if isinstance(raw_value, bool):
                raise ValueError(f"{field} must be a number.")

            value = float(raw_value)

            if not (value == value and abs(value) != float("inf")):
                raise ValueError(f"{field} must be finite.")

            values[field] = value

        months = values["studyDurationMonths"]
        tuition = values["tuitionPerYear"]
        living = values["monthlyLiving"]
        initial = values["initialExpenses"]
        funds = values["availableFunds"]
        rate = values["exchangeRate"]

        if months <= 0:
            raise ValueError("Study duration must be greater than zero.")

        if rate <= 0:
            raise ValueError("Exchange rate must be greater than zero.")

        if any(v < 0 for v in (tuition, living, initial, funds)):
            raise ValueError("Financial values cannot be negative.")

        total_tuition = tuition * months / 12
        total_living = living * months
        total_cost = total_tuition + total_living + initial
        converted_funds = funds * rate

        funding_gap = max(0.0, total_cost - converted_funds)
        surplus = max(0.0, converted_funds - total_cost)

        coverage = (
            min(100.0, converted_funds / total_cost * 100)
            if total_cost > 0
            else 0.0
        )

        home_currency = str(context.get("homeCurrency", "BDT"))[:10]
        dest_currency = str(context.get("destCurrency", "CAD"))[:10]

        assumptions = [
            field for field in defaults if field not in supplied_fields
        ]

        return {
            "destination": str(context.get("destination", "Not specified"))[:150],
            "university": str(context.get("university", "Not specified"))[:150,
            ],
            "destCurrency": dest_currency,
            "homeCurrency": home_currency,
            "exchangeRate": rate,
            "exchangeRateMeaning": (
                f"1 {home_currency} = {rate} {dest_currency}"
            ),
            "studyDurationMonths": months,
            "totalTuition": round(total_tuition, 2),
            "totalLiving": round(total_living, 2),
            "initialExpenses": round(initial, 2),
            "totalEstimatedCost": round(total_cost, 2),
            "availableFundsHomeCurrency": round(funds, 2),
            "convertedAvailableFunds": round(converted_funds, 2),
            "fundingGap": round(funding_gap, 2),
            "surplus": round(surplus, 2),
            "coveragePct": round(coverage, 1),
            "assumedFields": assumptions,
            "isEstimate": bool(assumptions),
        }

    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"Invalid financial context: {exc}") from exc


# =========================================================
# GEMINI API
# =========================================================

def call_gemini(prompt):
    """Call Gemini's REST API and return the generated text."""

    if MOCK_MODE:
        raise RuntimeError(
            "GEMINI_API_KEY is missing or is still a placeholder. "
            "Configure backend/.env and restart the server."
        )

    # Use the API key in a header instead of including it in the URL.
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{MODEL}:generateContent"
    )

    payload = {
        "system_instruction": {
            "parts": [{"text": SYSTEM_INSTRUCTION}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "temperature": 0.4,
        },
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": API_KEY,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            req, timeout=API_TIMEOUT_SECONDS
        ) as response:
            result = json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as exc:
        # Do not expose credentials or the full request URL.
        try:
            error_body = json.loads(
                exc.read().decode("utf-8", errors="replace")
            )
            api_error = error_body.get("error", {})
            detail = str(api_error.get("message", "No error detail"))[:700]
        except (ValueError, AttributeError):
            detail = "No readable error detail."

        if exc.code in (401, 403):
            hint = " Check the API key and its permissions."
        elif exc.code == 404:
            hint = (
                f" Model '{MODEL}' may be unavailable. Check the model "
                "against the models available to your API key."
            )
        elif exc.code == 429:
            hint = " API quota or rate limit reached."
        elif exc.code == 400:
            hint = " Check the request parameters and model compatibility."
        elif exc.code >= 500:
            hint = " Google API may be temporarily unavailable."
        else:
            hint = ""

        raise RuntimeError(
            f"Gemini HTTP {exc.code}: {detail}.{hint}"
        ) from None

    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", "Network error")
        raise RuntimeError(
            f"Could not connect to Gemini. Check internet and API access. "
            f"Details: {reason}"
        ) from None

    except (TimeoutError, OSError):
        raise RuntimeError(
            f"Gemini request timed out or network I/O failed "
            f"after {API_TIMEOUT_SECONDS} seconds."
        ) from None

    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RuntimeError(
            "Gemini returned a response that was not valid JSON."
        ) from None

    candidates = result.get("candidates") or []

    if not candidates:
        feedback = result.get("promptFeedback") or {}
        block_reason = feedback.get("blockReason", "unknown")
        raise RuntimeError(
            f"Gemini returned no answer. Block reason: {block_reason}"
        )

    candidate = candidates[0]
    finish_reason = candidate.get("finishReason", "unknown")

    parts = (candidate.get("content") or {}).get("parts") or []

    answer = "\n".join(
        part["text"]
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ).strip()

    logger.info("Gemini finishReason: %s", finish_reason)

    if finish_reason == "MAX_TOKENS":
        logger.warning("Response may be truncated by the output token limit.")

    if finish_reason == "SAFETY":
        raise RuntimeError(
            "Gemini did not return an answer because of safety filtering."
        )

    if not answer:
        raise RuntimeError(
            f"Gemini returned empty text (finish reason: {finish_reason})."
        )

    return answer, finish_reason


# =========================================================
# HEALTH ENDPOINT
# =========================================================

@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "FinBridge AI Study Abroad Finance Advisor",
        "mode": "mock" if MOCK_MODE else "real",
        "model": None if MOCK_MODE else MODEL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# =========================================================
# AI ADVISOR ENDPOINT
# =========================================================

@app.post("/api/ai-advisor")
def ai_advisor():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "Request body must be a valid JSON object."
        }), 400

    message = data.get("message")

    if not isinstance(message, str) or not message.strip():
        return jsonify({
            "error": "Field 'message' is required and must be text."
        }), 400

    message = message.strip()

    if len(message) > 4000:
        return jsonify({
            "error": "Message is too long (maximum 4000 characters)."
        }), 400

    context = data.get("context", {})

    if not isinstance(context, dict):
        return jsonify({
            "error": "'context' must be a JSON object."
        }), 400

    try:
        # Only calculate and attach a budget when relevant.
        relevant_finance_question = is_finance_question(message)

        calculations = (
            calculate_finances(context)
            if relevant_finance_question
            else {}
        )

    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if MOCK_MODE:
        return jsonify({
            "reply": (
                "Demo mode is active; this is not a live AI answer. "
                "Add a valid GEMINI_API_KEY to backend/.env and restart "
                "the server."
            ),
            "mode": "mock",
            "model": None,
            "calculations": calculations,
            "disclaimer": (
                "Educational guidance only; not professional financial advice."
            ),
        })

    prompt_parts = [
        "Answer the following student question directly.",
        "Do not assume any missing location or personal details.",
        f"\nStudent question:\n{message}",
    ]

    if calculations:
        c = calculations

        prompt_parts.append(
            "\n\nRelevant financial planning estimate supplied by the app:"
            "\nTreat this as an estimate, not as verified official data."
            f"\n- Destination: {c['destination']}"
            f"\n- University: {c['university']}"
            f"\n- Study duration: {c['studyDurationMonths']} months"
            f"\n- Estimated total cost: "
            f"{c['destCurrency']} {c['totalEstimatedCost']:,.2f}"
            f"\n- Estimated tuition: "
            f"{c['destCurrency']} {c['totalTuition']:,.2f}"
            f"\n- Estimated living expenses: "
            f"{c['destCurrency']} {c['totalLiving']:,.2f}"
            f"\n- Initial expenses: "
            f"{c['destCurrency']} {c['initialExpenses']:,.2f}"
            f"\n- Converted available funds: "
            f"{c['destCurrency']} {c['convertedAvailableFunds']:,.2f}"
            f"\n- Estimated funding gap: "
            f"{c['destCurrency']} {c['fundingGap']:,.2f}"
            f"\n- Exchange rate assumption: {c['exchangeRateMeaning']}"
        )

        if c["assumedFields"]:
            prompt_parts.append(
                "\nImportant: These fields were not provided by the user "
                "and use default planning assumptions: "
                + ", ".join(c["assumedFields"])
                + ". Clearly disclose this when using the estimate."
            )

    prompt = "\n".join(prompt_parts)

    try:
        logger.info("Sending request to configured Gemini model: %s", MODEL)

        reply, finish_reason = call_gemini(prompt)

        logger.info("Gemini response received.")

        return jsonify({
            "reply": reply,
            "mode": "real",
            "model": MODEL,
            "finishReason": finish_reason,
            "truncated": finish_reason == "MAX_TOKENS",
            "calculations": calculations,
            "disclaimer": (
                "Educational guidance only; not professional financial advice."
            ),
        })

    except RuntimeError as exc:
        # Details are useful during development, but may contain provider
        # messages. Never log API keys or request URLs.
        logger.error("Gemini request failed: %s", exc)

        return jsonify({
            "error": "Gemini API request failed.",
            "details": str(exc)[:1200],
            "mode": "error",
            "model": MODEL,
            "calculations": calculations,
        }), 502

    except Exception:
        logger.exception("Unexpected AI advisor error.")

        return jsonify({
            "error": "An unexpected server error occurred.",
            "mode": "error",
            "calculations": calculations,
        }), 500


# =========================================================
# ERROR HANDLERS
# =========================================================

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "Request is too large."}), 413


@app.errorhandler(404)
def not_found(_error):
    return jsonify({"error": "API endpoint not found."}), 404


# =========================================================
# START SERVER
# =========================================================

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "false").lower() in {
        "1", "true", "yes"
    }

    logger.info("FinBridge mode: %s", "mock" if MOCK_MODE else "real")
    logger.info("Configured model: %s", MODEL)
    logger.info("Starting server on http://127.0.0.1:%s", port)

    app.run(
        host="127.0.0.1",
        port=port,
        debug=debug,
    )
