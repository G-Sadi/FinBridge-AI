# FinBridge AI Study Abroad Finance Advisor

A complete, working full-stack prototype for the **FinBridge AI Study Abroad Finance Advisor**, matching the design, tone, and financial models of [https://finbridge-ai-app.onrender.com/](https://finbridge-ai-app.onrender.com/).

---

## 📁 Directory Structure & File Inventory

```text
FinBridge-AI-Advisor/
│
├── backend/
│   ├── ai_advisor.py         ← Main Python Flask server + Gemini API + FinBridge calculation engine
│   ├── app.py                ← Compatibility alias (imports and runs ai_advisor.py)
│   ├── requirements.txt      ← Minimal Python dependencies
│   ├── .env                  ← 🔐 Local secret API keys (gitignored — never committed)
│   ├── .env.example          ← Template with placeholders (safe for GitHub)
│   └── .gitignore            ← Excludes .env, __pycache__, venv
│
├── frontend/
│   ├── index.html            ← Vite HTML entry point
│   ├── package.json          ← React 18, Vite, TypeScript dependencies
│   ├── tsconfig.json         ← Strict TypeScript compiler options
│   ├── vite.config.ts        ← Vite config with /api reverse proxy to Flask (Port 5000)
│   └── src/
│       ├── main.tsx          ← React DOM entry point
│       ├── App.tsx           ← Root container
│       ├── App.css           ← Root container styling
│       ├── index.css         ← Global CSS resets
│       ├── AIAdvisor.tsx     ← Responsive FinBridge Chat Component ⭐
│       ├── AIAdvisor.css     ← Authentic FinBridge styling (Manrope & DM Sans)
│       └── vite-env.d.ts     ← Vite client types
│
└── README.md                 ← Complete documentation, testing & integration guide
```

---

## ⚡ Prerequisites & Environment Verification

| Tool | Status | Windows Location / Command |
| :--- | :--- | :--- |
| **Python** | ✅ Installed | `python --version` (3.10+) |
| **Node.js** | ✅ Installed | `C:\Program Files\nodejs\node.exe` (v20+) |
| **npm** | ✅ Installed | `C:\Program Files\nodejs\npm.cmd` |

*(If Node/npm is not recognized in a new PowerShell window, add it to your session PATH: `$env:PATH = "C:\Program Files\nodejs;" + $env:PATH`)*

---

## 🚀 Step-by-Step Run Instructions (Windows)

### Step 1: Start the Backend (Terminal 1)

```powershell
cd C:\Users\Dell\.gemini\antigravity\scratch\FinBridge-AI-Advisor\backend

# Install dependencies (only required on first setup)
pip install -r requirements.txt

# Launch Flask API server
python ai_advisor.py
```
*The server will start on `http://localhost:5000`.*

### Step 2: Start the Frontend (Terminal 2)

```powershell
cd C:\Users\Dell\.gemini\antigravity\scratch\FinBridge-AI-Advisor\frontend

# Ensure Node.js is in PATH
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH

# Install packages (only required on first setup)
npm install

# Start Vite dev server
npm run dev
```
*The web interface will open on `http://localhost:5173`.*

---

## 🔑 Activating Live Google Gemini AI

By default, if no API key is detected, the server runs in **Mock Mode** with labeled educational guidance responses.

To activate real Gemini AI:
1. Obtain a free API key at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Open `backend/.env` in Notepad:
   ```env
   GEMINI_API_KEY=AIzaSy...your_actual_key_here
   FLASK_ENV=development
   FLASK_PORT=5000
   ```
3. Restart `python ai_advisor.py`. The console will display:
   ```
   [FinBridge] ✅ Real Gemini mode active — using gemini-1.5-flash
   ```

---

## 🧪 Verified API Testing

### Test 1: Health Check (`GET /api/health`)

**PowerShell Command:**
```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/health -Method Get | ConvertTo-Json
```

**Response:**
```json
{
  "mode": "mock",
  "model": "none (mock)",
  "service": "FinBridge AI Study Abroad Finance Advisor",
  "status": "ok",
  "timestamp": "2026-10-19T14:53:42.643490+00:00"
}
```

---

### Test 2: AI Advisor Query (`POST /api/ai-advisor`)

**PowerShell Command:**
```powershell
$body = @{
    message = "How do I calculate and close my funding gap for Toronto?"
    context = @{
        destination = "Toronto, Canada"
        university = "University of Toronto"
        destCurrency = "CAD"
        homeCurrency = "BDT"
        tuitionPerYear = 45000
        monthlyLiving = 1700
        studyDurationMonths = 24
        initialExpenses = 4200
        availableFunds = 8000000
        exchangeRate = 0.0112
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://localhost:5000/api/ai-advisor -Method Post -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 5
```

**Response:**
```json
{
  "mode": "mock",
  "reply": "🔶 [MOCK MODE — Educational Guidance]\n\nManaging your funding gap is all about breaking down the timeline before your visa application.\n\n📊 **Your Current Study Plan Summary:**\n• **Destination:** Toronto, Canada\n• **Total Estimated Cost:** CAD 135,000 (Tuition + Living + Initial)\n• **Converted Savings:** CAD 89,600 (8,000,000 BDT)\n• **Funding Gap:** CAD 45,400 (66.4% covered)...",
  "calculations": {
    "destination": "Toronto, Canada",
    "university": "University of Toronto",
    "destCurrency": "CAD",
    "homeCurrency": "BDT",
    "exchangeRate": 0.0112,
    "studyDurationMonths": 24,
    "totalTuition": 90000.0,
    "totalLiving": 40800.0,
    "initialExpenses": 4200.0,
    "totalEstimatedCost": 135000.0,
    "availableFunds": 8000000.0,
    "convertedAvailableFunds": 89600.0,
    "fundingGap": 45400.0,
    "coveragePct": 66.4
  },
  "disclaimer": "Educational guidance only — not professional financial advice."
}
```

---

### Test 3: Request Validation (`POST /api/ai-advisor` with empty message)

**PowerShell Command:**
```powershell
try {
    $errBody = '{"message": ""}'
    Invoke-RestMethod -Uri http://localhost:5000/api/ai-advisor -Method Post -ContentType "application/json" -Body $errBody
} catch {
    "STATUS: $($_.Exception.Response.StatusCode.value__) - $($_.Exception.Message)"
}
```

**Response:**
```
STATUS: 400 - The remote server returned an error: (400) Bad Request.
```

---

## 🌐 Integration Guide: Adding to the Live Website (`https://finbridge-ai-app.onrender.com/`)

The live site is built with React, Tailwind, and TanStack Router (`/advisor`, `/planner`, etc.). Follow these 3 non-destructive steps to integrate this working advisor:

### Step 1: Copy the Component
Copy `frontend/src/AIAdvisor.tsx` and `frontend/src/AIAdvisor.css` into your existing website repository under `src/components/AIAdvisor.tsx` or `src/routes/advisor.tsx`.

### Step 2: Hook up the Route
In the existing router (e.g. `src/routes/advisor.tsx`), replace the static placeholder text:
```tsx
import AIAdvisor from '../components/AIAdvisor'

export function AdvisorPage() {
  return (
    <div className="min-h-screen bg-background">
      <AIAdvisor />
    </div>
  )
}
```

### Step 3: Deploy the Backend API
In your Render deployment configuration:
- Either add `ai_advisor.py` as a Python Web Service on Render, OR
- Add the `POST /api/ai-advisor` handler into your existing Express/Node or Python API route.
- In Render dashboard, set Environment Variable:
  `GEMINI_API_KEY = your_key`
- Configure your frontend reverse proxy or `VITE_API_BASE_URL` to point to the endpoint.
