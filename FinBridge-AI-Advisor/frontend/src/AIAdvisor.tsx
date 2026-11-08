import { useState, useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import {
  getApiKey,
  setApiKey,
  clearApiKey,
  hasApiKey,
  testGeminiKey,
  generateClientAiResponse,
} from './geminiService'
import type { CalculationSummary } from './geminiService'
import './AIAdvisor.css'

export interface FinancialContext {
  destination: string
  university: string
  destCurrency: string
  homeCurrency: string
  tuitionPerYear: number
  monthlyLiving: number
  studyDurationMonths: number
  initialExpenses: number
  availableFunds: number
  exchangeRate: number
}

const DESTINATION_PRESETS: Record<string, FinancialContext> = {
  'Toronto, Canada': {
    destination: 'Toronto, Canada',
    university: 'University of Toronto',
    destCurrency: 'CAD',
    homeCurrency: 'BDT',
    tuitionPerYear: 45000,
    monthlyLiving: 1700,
    studyDurationMonths: 24,
    initialExpenses: 4200,
    availableFunds: 8000000,
    exchangeRate: 0.0112,
  },
  'Boston, USA': {
    destination: 'Boston, USA',
    university: 'Northeastern University',
    destCurrency: 'USD',
    homeCurrency: 'INR',
    tuitionPerYear: 52000,
    monthlyLiving: 2100,
    studyDurationMonths: 24,
    initialExpenses: 5000,
    availableFunds: 6000000,
    exchangeRate: 0.012,
  },
  'Manchester, UK': {
    destination: 'Manchester, UK',
    university: 'University of Manchester',
    destCurrency: 'GBP',
    homeCurrency: 'NGN',
    tuitionPerYear: 28000,
    monthlyLiving: 1250,
    studyDurationMonths: 12,
    initialExpenses: 3500,
    availableFunds: 35000000,
    exchangeRate: 0.00065,
  },
  'Melbourne, Australia': {
    destination: 'Melbourne, Australia',
    university: 'University of Melbourne',
    destCurrency: 'AUD',
    homeCurrency: 'BDT',
    tuitionPerYear: 44000,
    monthlyLiving: 1850,
    studyDurationMonths: 24,
    initialExpenses: 4500,
    availableFunds: 7500000,
    exchangeRate: 0.0125,
  },
  'Berlin, Germany': {
    destination: 'Berlin, Germany',
    university: 'Technical University of Berlin',
    destCurrency: 'EUR',
    homeCurrency: 'PKR',
    tuitionPerYear: 1500,
    monthlyLiving: 1100,
    studyDurationMonths: 24,
    initialExpenses: 3000,
    availableFunds: 6000000,
    exchangeRate: 0.0033,
  },
}

type MessageRole = 'user' | 'assistant'
type BackendMode = 'real' | 'mock' | 'error'

interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  mode?: 'real' | 'mock'
  calculations?: CalculationSummary
}

interface ApiResponse {
  reply?: string
  error?: string
  details?: string
  mode?: BackendMode
  model?: string | null
  finishReason?: string
  truncated?: boolean
  calculations?: CalculationSummary
  disclaimer?: string
}

interface HealthResponse {
  status?: string
  mode?: 'real' | 'mock'
  model?: string | null
}

const SUGGESTED_PROMPTS = [
  'How much should I save before my first semester?',
  'Is my housing budget too high?',
  'How do exchange rates affect my tuition?',
  "What's a realistic student part-time income?",
  'How do I calculate and close my funding gap?',
]

// Defensive base URL resolution
const API_BASE = (
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL)
    : ''
).replace(/\/+$/, '')

const API_URL = `${API_BASE}/api`

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Checks whether the question specifically asks about the user's personal
 * study plan numbers so we only attach profile data when relevant.
 */
function needsFinancialContext(message: string): boolean {
  const text = message.toLowerCase()

  const planSpecificPatterns = [
    /\bmy (study )?plan\b/,
    /\bmy (current )?budget\b/,
    /\bmy financial situation\b/,
    /\bmy funding gap\b/,
    /\bmy savings\b/,
    /\bmy available funds\b/,
    /\bmy tuition\b/,
    /\bmy living expenses\b/,
    /\bmy housing budget\b/,
    /\bmy university\b/,
    /\bmy destination\b/,
    /\bmy exchange rate\b/,
    /\bevaluate my\b/,
    /\banaly[sz]e my\b/,
    /\baccording to my\b/,
    /\bbased on my\b/,
    /\bwith my current\b/,
    /\busing my (financial )?profile\b/,
  ]

  const generalFinancePatterns = [
    /\btuition\b/,
    /\bbudget\b/,
    /\bsavings?\b/,
    /\bfunding gap\b/,
    /\bexchange rate\b/,
    /\bliving expenses\b/,
    /\bhousing costs?\b/,
    /\bfirst semester\b/,
    /\btotal cost\b/,
    /\bafford\b/,
  ]

  if (planSpecificPatterns.some((pattern) => pattern.test(text))) {
    return true
  }

  if (
    /\b(part[- ]time|part time|student)\b/.test(text) &&
    /\b(income|earnings?|wages?|salary|jobs?|work|working)\b/.test(text) &&
    !/\bmy\b/.test(text)
  ) {
    return false
  }

  return generalFinancePatterns.some((pattern) => pattern.test(text))
}

function renderMarkdown(content: string) {
  return content.split('\n').map((line, index) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    const isBullet = /^\s*([-*•]|\d+\.)\s/.test(line)

    return (
      <div
        key={index}
        className={`msg-line ${
          isBullet ? 'bullet-line' : ''
        } ${line.trim() === '' ? 'empty-line' : ''}`}
      >
        {parts.map((part, partIndex) => {
          if (
            part.startsWith('**') &&
            part.endsWith('**') &&
            part.length >= 4
          ) {
            return (
              <strong key={partIndex}>
                {part.slice(2, -2)}
              </strong>
            )
          }

          return part
        })}
      </div>
    )
  })
}

export default function AIAdvisor() {
  const [profile, setProfile] = useState<FinancialContext>(
    DESTINATION_PRESETS['Toronto, Canada'],
  )

  const [showProfileDrawer, setShowProfileDrawer] = useState(false)

  // API Key management modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState(() => getApiKey())
  const [showKeyPassword, setShowKeyPassword] = useState(false)
  const [keyValidationStatus, setKeyValidationStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle')
  const [keyValidationMsg, setKeyValidationMsg] = useState('')
  const [hasUserKey, setHasUserKey] = useState(() => hasApiKey())

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi! I'm your **FinBridge Study Abroad Finance Advisor**.\n\n" +
        'Ask me about student income, tuition, living expenses, ' +
        'savings, exchange rates, or closing your funding gap.\n\n' +
        'I provide direct answers and never invent assumptions without your confirmation.',
      timestamp: new Date(),
    },
  ])

  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [backendMode, setBackendMode] = useState<'real' | 'mock' | null>(() => {
    return hasApiKey() ? 'real' : 'mock'
  })

  const [backendModel, setBackendModel] = useState<string | null>(() => {
    return hasApiKey() ? 'gemini-2.5-flash (Client)' : null
  })

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const tuitionTotal =
    (profile.tuitionPerYear * profile.studyDurationMonths) / 12

  const livingTotal =
    profile.monthlyLiving * profile.studyDurationMonths

  const totalCost =
    tuitionTotal + livingTotal + profile.initialExpenses

  const convertedFunds =
    profile.availableFunds * profile.exchangeRate

  const fundingGap = Math.max(0, totalCost - convertedFunds)

  const coveragePct =
    totalCost > 0
      ? Math.min(
          100,
          Math.round((convertedFunds / totalCost) * 100),
        )
      : 0

  // Keep the latest message visible.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages, isLoading])

  // Try checking local backend health if running locally
  useEffect(() => {
    const controller = new AbortController()

    async function loadHealth() {
      try {
        const response = await fetch(`${API_URL}/health`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`)
        }

        const data = (await response.json()) as HealthResponse

        if (data.mode === 'real') {
          setBackendMode('real')
          setBackendModel(data.model ? `${data.model} (Backend)` : 'Gemini (Backend)')
        }
      } catch (_) {
        // Expected when deployed statically to GitHub Pages.
        // Fall back to client status based on API key presence.
        if (hasApiKey()) {
          setBackendMode('real')
          setBackendModel('gemini-2.5-flash (Client)')
        } else {
          setBackendMode('mock')
          setBackendModel(null)
        }
      }
    }

    void loadHealth()

    return () => controller.abort()
  }, [])

  // Automatically resize the input.
  useEffect(() => {
    const textarea = textareaRef.current

    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [inputValue])

  async function handleSaveAndTestKey() {
    const key = apiKeyInput.trim()
    if (!key) {
      setKeyValidationStatus('error')
      setKeyValidationMsg('Please paste a valid Gemini API key.')
      return
    }

    setKeyValidationStatus('testing')
    setKeyValidationMsg('Validating API key with Google Gemini...')

    const testResult = await testGeminiKey(key)

    if (testResult.success) {
      setApiKey(key)
      setHasUserKey(true)
      setBackendMode('real')
      setBackendModel(`${testResult.model || 'gemini-2.5-flash'} (Client)`)
      setKeyValidationStatus('success')
      setKeyValidationMsg('✅ API key verified successfully! Live Gemini AI is now active.')
      setTimeout(() => {
        setShowApiKeyModal(false)
        setKeyValidationStatus('idle')
        setKeyValidationMsg('')
      }, 1400)
    } else {
      setKeyValidationStatus('error')
      setKeyValidationMsg(`❌ ${testResult.message}`)
    }
  }

  function handleClearKey() {
    clearApiKey()
    setApiKeyInput('')
    setHasUserKey(false)
    setBackendMode('mock')
    setBackendModel(null)
    setKeyValidationStatus('idle')
    setKeyValidationMsg('API key removed. Running in educational advisor mode.')
  }

  async function sendMessage(textToSend?: string) {
    const text = (textToSend ?? inputValue).trim()

    if (!text || isLoading) return

    setInputValue('')
    setError(null)

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }

    setMessages((previous) => [...previous, userMessage])
    setIsLoading(true)

    try {
      const includeContext = needsFinancialContext(text)

      const payload: {
        message: string
        context?: FinancialContext
      } = {
        message: text,
      }

      if (includeContext) {
        payload.context = profile
      }

      // Step 1: Attempt to contact backend if reachable
      let backendSuccess = false
      let apiData: ApiResponse | null = null

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 4000)

        const response = await fetch(`${API_URL}/ai-advisor`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (response.ok) {
          apiData = (await response.json()) as ApiResponse
          if (apiData?.reply) {
            backendSuccess = true
          }
        }
      } catch (_) {
        // Backend not available (common on static GitHub Pages)
        backendSuccess = false
      }

      if (backendSuccess && apiData && apiData.reply) {
        if (apiData.mode) {
          setBackendMode(apiData.mode === 'real' ? 'real' : 'mock')
        }
        if (apiData.model) {
          setBackendModel(`${apiData.model} (Backend)`)
        }

        let answer = apiData.reply
        if (apiData.truncated || apiData.finishReason === 'MAX_TOKENS') {
          answer +=
            '\n\n*Note: The answer may be incomplete because the AI reached its output limit.*'
        }

        setMessages((previous) => [
          ...previous,
          {
            id: generateId(),
            role: 'assistant',
            content: answer,
            timestamp: new Date(),
            mode: apiData?.mode === 'mock' ? 'mock' : 'real',
            calculations: apiData?.calculations,
          },
        ])
        return
      }

      // Step 2: Standalone Client-Side Gemini Engine (Direct browser call for GitHub Pages)
      const clientRes = await generateClientAiResponse(
        text,
        includeContext ? profile : undefined,
        [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      )

      setBackendMode(clientRes.mode)
      if (clientRes.model) {
        setBackendModel(`${clientRes.model} (Client)`)
      }

      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'assistant',
          content: clientRes.reply,
          timestamp: new Date(),
          mode: clientRes.mode,
          calculations: clientRes.calculations,
        },
      ])
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while processing your request.'

      setError(`⚠️ ${errorMessage}`)
    } finally {
      setIsLoading(false)
      window.setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  function handlePresetChange(destination: string) {
    const preset = DESTINATION_PRESETS[destination]

    if (preset) {
      setProfile({ ...preset })
    }
  }

  return (
    <div className="finbridge-advisor-wrapper">
      {/* Google Gemini API Key Configuration Modal */}
      {showApiKeyModal && (
        <div
          className="api-key-modal-overlay"
          onClick={() => setShowApiKeyModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-api-title"
        >
          <div
            className="api-key-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-icon">🔑</span>
                <h3 id="modal-api-title" className="modal-title">
                  Google Gemini AI Settings
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowApiKeyModal(false)}
                aria-label="Close API settings"
              >
                ✕
              </button>
            </div>

            <p className="modal-description">
              On static hosting like <strong>GitHub Pages</strong>, FinBridge AI
              connects directly to Google Gemini from your browser. Your key is stored
              safely in your local browser storage.
            </p>

            <div className="key-input-wrapper">
              <input
                type={showKeyPassword ? 'text' : 'password'}
                className="key-input"
                placeholder="AIzaSy... (Paste Google Gemini API Key)"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                className="key-toggle-vis-btn"
                onClick={() => setShowKeyPassword((prev) => !prev)}
                title={showKeyPassword ? 'Hide Key' : 'Show Key'}
                aria-label={showKeyPassword ? 'Hide Key' : 'Show Key'}
              >
                {showKeyPassword ? '👁️' : '🔒'}
              </button>
            </div>

            {keyValidationMsg && (
              <div className={`key-status-banner ${keyValidationStatus}`} role="alert">
                {keyValidationMsg}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="save-key-btn"
                onClick={() => void handleSaveAndTestKey()}
                disabled={keyValidationStatus === 'testing'}
              >
                {keyValidationStatus === 'testing' ? (
                  <>
                    <span className="btn-spinner" /> Validating...
                  </>
                ) : (
                  'Save & Activate Key'
                )}
              </button>

              {hasUserKey && (
                <button
                  type="button"
                  className="clear-key-btn"
                  onClick={handleClearKey}
                >
                  Clear Key
                </button>
              )}
            </div>

            <div className="modal-footer-help">
              Don't have an API key?{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a free key from Google AI Studio ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Main App Header */}
      <header className="finbridge-header">
        <div className="header-brand">
          <div className="brand-logo-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="earth-icon"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
          </div>

          <div className="brand-titles">
            <h1 className="brand-name">
              FinBridge<span className="brand-ai"> AI</span>
            </h1>
            <p className="brand-tagline">
              AI Study Abroad Finance Advisor
            </p>
          </div>
        </div>

        <div className="header-badges">
          <button
            type="button"
            className={`key-config-btn ${hasUserKey ? 'has-key' : 'needs-key'}`}
            onClick={() => {
              setApiKeyInput(getApiKey())
              setKeyValidationStatus('idle')
              setKeyValidationMsg('')
              setShowApiKeyModal(true)
            }}
            title="Configure Gemini API Key"
          >
            🔑 {hasUserKey ? 'Gemini Live' : 'API Key'}
          </button>

          <span
            className={`badge-pill mode-badge ${
              backendMode === 'real' ? 'real' : 'mock'
            }`}
            title={
              backendMode === 'real'
                ? `Active model: ${backendModel || 'Gemini AI'}`
                : 'Running in educational advisor mode'
            }
          >
            {backendMode === 'real'
              ? backendModel
                ? `✓ ${backendModel}`
                : '✓ Gemini Live'
              : '💡 Educational Guide'}
          </span>

          <button
            type="button"
            className="planner-toggle-btn"
            onClick={() => setShowProfileDrawer((open) => !open)}
            aria-expanded={showProfileDrawer}
            title="Toggle Financial Profile & Planner Numbers"
          >
            📊 {profile.destination.split(',')[0]} ({coveragePct}% covered)
          </button>
        </div>
      </header>

      {/* Mock Notice Bar if no key */}
      {backendMode === 'mock' && (
        <div className="mock-notice-bar" role="alert">
          <span className="mock-icon">💡</span>
          <div className="mock-text">
            <strong>Educational Guide Mode:</strong> You are receiving automated
            financial formulas and rules. To unlock dynamic live Gemini responses on GitHub Pages,
            {' '}
            <button
              type="button"
              className="inline-key-btn"
              onClick={() => {
                setApiKeyInput(getApiKey())
                setShowApiKeyModal(true)
              }}
            >
              Add your free Gemini API key
            </button>
            .
          </div>
        </div>
      )}

      {/* Snapshot Card */}
      <section className="snapshot-card" aria-label="Financial summary">
        <div className="snapshot-header">
          <div className="snapshot-title-group">
            <span className="plane-icon">✈️</span>
            <div>
              <span className="snapshot-dest">{profile.destination}</span>
              <span className="snapshot-uni">
                {' '}· {profile.university}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="snapshot-edit-btn"
            onClick={() => setShowProfileDrawer((open) => !open)}
          >
            {showProfileDrawer ? 'Hide Plan ✕' : 'Edit Plan ✎'}
          </button>
        </div>

        <div className="snapshot-metrics">
          <div className="metric-box">
            <span className="metric-label">Estimated Total Cost</span>
            <span className="metric-val">
              {profile.destCurrency} {totalCost.toLocaleString()}
            </span>
            <span className="metric-sub">
              {profile.studyDurationMonths} months · Tuition + Living
            </span>
          </div>

          <div className="metric-box">
            <span className="metric-label">Available Savings</span>
            <span className="metric-val">
              {profile.destCurrency}{' '}
              {convertedFunds.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </span>
            <span className="metric-sub">
              {profile.availableFunds.toLocaleString()}{' '}
              {profile.homeCurrency}
            </span>
          </div>

          <div className="metric-box highlight">
            <span className="metric-label">Funding Gap</span>
            <span className="metric-val gap-val">
              {profile.destCurrency}{' '}
              {fundingGap.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </span>
            <span className="metric-sub">
              {coveragePct}% covered by funds
            </span>
          </div>
        </div>

        <div className="progress-bar-wrapper">
          <div
            className="progress-bar-fill"
            style={{ width: `${coveragePct}%` }}
            role="progressbar"
            aria-valuenow={coveragePct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        {showProfileDrawer && (
          <div className="plan-editor-drawer animate-in">
            <h3 className="drawer-title">
              Study Abroad Plan Parameters
            </h3>

            <div className="editor-grid">
              <div className="input-group">
                <label htmlFor="destination">Preset Destination</label>
                <select
                  id="destination"
                  value={profile.destination}
                  onChange={(e) => handlePresetChange(e.target.value)}
                >
                  {Object.keys(DESTINATION_PRESETS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label htmlFor="university">University</label>
                <input
                  id="university"
                  type="text"
                  value={profile.university}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      university: e.target.value,
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="tuition">
                  Tuition per year ({profile.destCurrency})
                </label>
                <input
                  id="tuition"
                  type="number"
                  min="0"
                  value={profile.tuitionPerYear}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      tuitionPerYear: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="living">
                  Monthly Living ({profile.destCurrency})
                </label>
                <input
                  id="living"
                  type="number"
                  min="0"
                  value={profile.monthlyLiving}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      monthlyLiving: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="duration">Duration (Months)</label>
                <input
                  id="duration"
                  type="number"
                  min="1"
                  value={profile.studyDurationMonths}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      studyDurationMonths: Math.max(
                        1,
                        Number(e.target.value) || 1,
                      ),
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="initial">
                  Initial Setup & Visa ({profile.destCurrency})
                </label>
                <input
                  id="initial"
                  type="number"
                  min="0"
                  value={profile.initialExpenses}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      initialExpenses: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="funds">
                  Available Savings ({profile.homeCurrency})
                </label>
                <input
                  id="funds"
                  type="number"
                  min="0"
                  value={profile.availableFunds}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      availableFunds: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div className="input-group">
                <label htmlFor="exchange">
                  Exchange Rate (1 {profile.homeCurrency} = ?{' '}
                  {profile.destCurrency})
                </label>
                <input
                  id="exchange"
                  type="number"
                  min="0.00000001"
                  step="0.0001"
                  value={profile.exchangeRate}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      exchangeRate: Math.max(
                        0.00000001,
                        Number(e.target.value) || 0.00000001,
                      ),
                    })
                  }
                />
              </div>
            </div>

            <button
              type="button"
              className="ask-plan-btn"
              onClick={() => {
                setShowProfileDrawer(false)
                void sendMessage(
                  'Evaluate my current study plan numbers and explain my funding gap.',
                )
              }}
            >
              💬 Ask AI to Evaluate This Study Plan
            </button>
          </div>
        )}
      </section>

      {/* Messages Stream */}
      <main className="messages-stream" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message-item ${msg.role}`}
          >
            {msg.role === 'assistant' && (
              <div
                className="avatar-icon compass-avatar"
                title="FinBridge AI Guide"
              >
                🧭
              </div>
            )}

            <div className={`message-bubble-box ${msg.role}`}>
              <div className="message-text">
                {renderMarkdown(msg.content)}
              </div>

              {msg.calculations?.totalEstimatedCost != null && (
                <div className="calc-pill">
                  📐 Plan snapshot: Cost{' '}
                  {msg.calculations.destCurrency}{' '}
                  {msg.calculations.totalEstimatedCost.toLocaleString()}
                  {' '}· Gap{' '}
                  {msg.calculations.destCurrency}{' '}
                  {msg.calculations.fundingGap?.toLocaleString() ?? 'N/A'}
                  {' '}({msg.calculations.coveragePct ?? 0}% covered)
                </div>
              )}

              <div className="message-foot">
                <span className="msg-timestamp">
                  {formatTime(msg.timestamp)}
                </span>
                {msg.mode === 'mock' && (
                  <span className="mock-tag">GUIDE</span>
                )}
                {msg.mode === 'real' && (
                  <span className="live-tag">GEMINI AI</span>
                )}
              </div>
            </div>

            {msg.role === 'user' && (
              <div className="avatar-icon user-avatar">👤</div>
            )}
          </div>
        ))}

        {isLoading && (
          <div
            className="message-item assistant"
            aria-label="FinBridge is analyzing"
          >
            <div className="avatar-icon compass-avatar">🧭</div>
            <div className="message-bubble-box assistant typing-box">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="typing-label">
                FinBridge is preparing your answer...
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="alert-error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="dismiss-btn"
              onClick={() => setError(null)}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Suggested Prompt Chips */}
      {messages.length <= 2 && !isLoading && (
        <section
          className="suggested-chips-section"
          aria-label="Suggested questions"
        >
          <span className="chips-title">
            💡 Common student finance questions:
          </span>

          <div className="chips-list">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chip-btn"
                onClick={() => void sendMessage(prompt)}
                disabled={isLoading}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Footer / Input Bar */}
      <footer className="advisor-footer">
        <div className="input-bar-container">
          <textarea
            ref={textareaRef}
            className="advisor-textarea"
            placeholder="Ask about tuition, budgets, exchange rates, or student income..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={4000}
            disabled={isLoading}
            aria-label="Chat input"
          />

          <button
            type="button"
            className={`send-action-btn ${
              isLoading || !inputValue.trim() ? 'disabled' : ''
            }`}
            onClick={() => void sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            aria-label="Send message"
          >
            {isLoading ? (
              <span className="btn-spinner" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="send-svg"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
            )}
          </button>
        </div>

        <p className="disclaimer-subtext">
          Educational guidance only — not professional financial advice.
          Exchange rates and university fees should be verified with official
          sources.
        </p>
      </footer>

      {/* Floating Chat Quick Launcher Button */}
      <button
        type="button"
        className="floating-chat-launcher"
        onClick={() => textareaRef.current?.focus()}
        title="Open FinBridge Chat Input"
        aria-label="Open FinBridge Chat Input"
      >
        🧭
      </button>
    </div>
  )
}
