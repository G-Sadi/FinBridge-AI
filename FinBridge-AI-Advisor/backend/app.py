"""
FinBridge AI Study Abroad Finance Advisor — Alias Entrypoint
Imports and exposes the Flask app from backend/ai_advisor.py
"""

from ai_advisor import app

if __name__ == "__main__":
    import os
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    print(f"[FinBridge] Starting Flask server on http://localhost:{port} (app.py -> ai_advisor.py)")
    app.run(host="0.0.0.0", port=port, debug=debug)
