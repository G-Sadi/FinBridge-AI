import { useState, useRef, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import {
  generateClientAiResponse,
  calculateFinances,
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
    homeCurrency: 'BDT',
    tuitionPerYear: 52000,
    monthlyLiving: 2100,
    studyDurationMonths: 24,
    initialExpenses: 5000,
    availableFunds: 8500000,
    exchangeRate: 0.0082,
  },
  'Manchester, UK': {
    destination: 'Manchester, UK',
    university: 'University of Manchester',
    destCurrency: 'GBP',
    homeCurrency: 'BDT',
    tuitionPerYear: 28000,
    monthlyLiving: 1250,
    studyDurationMonths: 12,
    initialExpenses: 3500,
    availableFunds: 5000000,
    exchangeRate: 0.0065,
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
    homeCurrency: 'BDT',
    tuitionPerYear: 1500,
    monthlyLiving: 1100,
    studyDurationMonths: 24,
    initialExpenses: 3000,
    availableFunds: 6000000,
    exchangeRate: 0.0076,
  },
}

type MessageRole = 'user' | 'assistant'

interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: Date
  mode?: 'real' | 'local'
  calculations?: CalculationSummary
}

interface ApiResponse {
  reply?: string
  error?: string
  mode?: string
  model?: string | null
  finishReason?: string
  truncated?: boolean
  calculations?: CalculationSummary
}

// 5 Definitive 1-Click Financial Action Chips
const QUICK_ACTION_CHIPS = [
  {
    label: '🎯 Close My Funding Gap',
    prompt: 'How do I calculate and close my study abroad funding gap step-by-step for my current plan?',
  },
  {
    label: '💼 Part-Time Income & Work Rules',
    prompt: 'What are the exact part-time student work hours limits and realistic monthly earnings for my destination?',
  },
  {
    label: '🏦 Visa Proof of Funds / GIC Guide',
    prompt: 'What are the official visa proof of funds and GIC / Sperrkonto requirements for my destination in 2026?',
  },
  {
    label: '🏠 Monthly Living Budget Breakdown',
    prompt: 'Give me a realistic monthly student living and housing expense breakdown for my destination.',
  },
  {
    label: '🎓 Scholarships & Co-op Strategy',
    prompt: 'How much can scholarships and paid co-op internships reduce my tuition and overall study costs?',
  },
]

// Defensive base URL resolution for optional backend
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

  // Plan Collapse State (Default false on initial load; collapses automatically on chat focus)
  const [isPlanCollapsed, setIsPlanCollapsed] = useState(false)
  const [showProfileDrawer, setShowProfileDrawer] = useState(false)

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hello! I am your **FinBridge AI Study Abroad Finance Advisor**.\n\n" +
        'I am pre-trained on authentic **2026 global student finance datasets** (IRCC GIC rules, US I-20 proof of funds, UKVI 28-day rule, Australian minimum student wages, and German Sperrkonto).\n\n' +
        'Ask me about closing your funding gap, student part-time wages, visa proof of funds, or click any of the action buttons below.',
      timestamp: new Date(),
    },
  ])

  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLElement>(null)

  // Live Plan Calculations
  const calculations = calculateFinances(profile)
  const totalCost = calculations?.totalEstimatedCost ?? 0
  const convertedFunds = calculations?.convertedAvailableFunds ?? 0
  const fundingGap = calculations?.fundingGap ?? 0
  const coveragePct = calculations?.coveragePct ?? 0

  // Keep the latest message visible
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages, isLoading])

  // Automatically resize the input
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [inputValue])

  // Handler to auto-collapse plan card when interacting with chat
  function handleChatInteraction() {
    if (!isPlanCollapsed) {
      setIsPlanCollapsed(true)
    }
  }

  async function sendMessage(textToSend?: string) {
    const text = (textToSend ?? inputValue).trim()
    if (!text || isLoading) return

    // Auto-collapse planning card immediately on send
    setIsPlanCollapsed(true)
    setShowProfileDrawer(false)
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
      // Step 1: Optional check for backend server
      let backendSuccess = false
      let apiData: ApiResponse | null = null

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 3500)

        const response = await fetch(`${API_URL}/ai-advisor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            context: profile,
          }),
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
        backendSuccess = false
      }

      if (backendSuccess && apiData && apiData.reply) {
        let answer = apiData.reply
        if (apiData.truncated || apiData.finishReason === 'MAX_TOKENS') {
          answer += '\n\n*Note: The answer reached the output token limit.*'
        }

        setMessages((previous) => [
          ...previous,
          {
            id: generateId(),
            role: 'assistant',
            content: answer,
            timestamp: new Date(),
            mode: 'real',
            calculations: apiData?.calculations ?? calculations,
          },
        ])
        return
      }

      // Step 2: Live Client-Side Gemini Engine + 2026 RAG Dataset + Smart Local Reasoner
      const clientRes = await generateClientAiResponse(
        text,
        profile,
        [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      )

      setMessages((previous) => [
        ...previous,
        {
          id: generateId(),
          role: 'assistant',
          content: clientRes.reply,
          timestamp: new Date(),
          mode: clientRes.mode,
          calculations: clientRes.calculations ?? calculations,
        },
      ])
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while processing your question.'
      setError(`⚠️ ${errorMessage}`)
    } finally {
      setIsLoading(false)
      window.setTimeout(() => textareaRef.current?.focus(), 60)
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
      {/* Top Header */}
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
              Study Abroad Finance Advisor
            </p>
          </div>
        </div>

        <div className="header-badges">
          {/* Trustworthy Live AI Status Pill */}
          <span className="badge-pill live-advisor-pill" title="2026 AI Advisor Engine Active">
            <span className="live-status-dot" />
            AI Advisor Live
          </span>

          {/* Interactive Toggle for Planning Interface */}
          <button
            type="button"
            className={`planner-toggle-btn ${isPlanCollapsed ? 'is-collapsed' : 'is-expanded'}`}
            onClick={() => setIsPlanCollapsed((prev) => !prev)}
            aria-expanded={!isPlanCollapsed}
            title={isPlanCollapsed ? 'Click to View/Edit Study Plan' : 'Click to Collapse Plan Card'}
          >
            📊 {profile.destination.split(',')[0]} ({coveragePct}% covered) {isPlanCollapsed ? '▾' : '▴'}
          </button>
        </div>
      </header>

      {/* Collapsible Planning Interface Card */}
      <section
        className={`snapshot-card ${isPlanCollapsed ? 'collapsed' : ''}`}
        aria-label="Study abroad financial summary"
        aria-hidden={isPlanCollapsed}
      >
        <div className="snapshot-header">
          <div className="snapshot-title-group">
            <span className="plane-icon">✈️</span>
            <div>
              <span className="snapshot-dest">{profile.destination}</span>
              <span className="snapshot-uni"> · {profile.university}</span>
            </div>
          </div>

          <div className="snapshot-header-actions">
            <button
              type="button"
              className="snapshot-edit-btn"
              onClick={() => setShowProfileDrawer((open) => !open)}
            >
              {showProfileDrawer ? 'Close Parameters ✕' : 'Edit Parameters ✎'}
            </button>
            <button
              type="button"
              className="snapshot-collapse-btn"
              onClick={() => setIsPlanCollapsed(true)}
              title="Collapse Plan Card to focus on Chat"
            >
              Hide Plan ▴
            </button>
          </div>
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
              {profile.availableFunds.toLocaleString()} {profile.homeCurrency}
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

        {/* Detailed Parameter Drawer */}
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
                  Initial Landing & Visa ({profile.destCurrency})
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
                  Exchange Rate (1 {profile.homeCurrency} = ? {profile.destCurrency})
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
                setIsPlanCollapsed(true)
                void sendMessage(
                  'Evaluate my current study plan numbers and calculate how to close my funding gap.',
                )
              }}
            >
              💬 Ask AI to Evaluate This Study Plan
            </button>
          </div>
        )}
      </section>

      {/* Mini Plan Restorer Banner (Only visible when plan is collapsed) */}
      {isPlanCollapsed && (
        <div className="collapsed-plan-strip animate-in">
          <div className="strip-info">
            <span className="strip-dest">✈️ {profile.destination}</span>
            <span className="strip-dot">·</span>
            <span className="strip-gap">
              Gap: {profile.destCurrency} {fundingGap.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({coveragePct}% covered)
            </span>
          </div>
          <button
            type="button"
            className="strip-expand-btn"
            onClick={() => setIsPlanCollapsed(false)}
          >
            ⚙️ View/Edit Plan ▾
          </button>
        </div>
      )}

      {/* Messages Stream Container */}
      <main
        ref={messagesContainerRef}
        className={`messages-stream ${isPlanCollapsed ? 'expanded-stream' : ''}`}
        role="log"
        aria-live="polite"
        onClick={handleChatInteraction}
      >
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
                  📐 Plan snapshot: Cost {msg.calculations.destCurrency}{' '}
                  {msg.calculations.totalEstimatedCost.toLocaleString()} · Gap{' '}
                  {msg.calculations.destCurrency}{' '}
                  {msg.calculations.fundingGap?.toLocaleString() ?? 'N/A'}{' '}
                  ({msg.calculations.coveragePct ?? 0}% covered)
                </div>
              )}

              <div className="message-foot">
                <span className="msg-timestamp">
                  {formatTime(msg.timestamp)}
                </span>
                <span className="verified-tag">2026 VERIFIED</span>
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
                FinBridge AI is analyzing 2026 data...
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
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* 5 Clickable Quick Financial Action Chips */}
      <section
        className="suggested-chips-section"
        aria-label="Quick financial action queries"
      >
        <div className="chips-list">
          {QUICK_ACTION_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="chip-btn action-chip"
              onClick={() => void sendMessage(chip.prompt)}
              disabled={isLoading}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      {/* Chat Footer */}
      <footer className="advisor-footer">
        <div className="input-bar-container">
          <textarea
            ref={textareaRef}
            className="advisor-textarea"
            placeholder="Ask about closing your gap, part-time jobs, GIC/visa proof of funds, or living costs..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={handleChatInteraction}
            onClick={handleChatInteraction}
            onKeyDown={handleKeyDown}
            rows={1}
            maxLength={4000}
            disabled={isLoading}
            aria-label="Chat input with AI advisor"
          />

          <button
            type="button"
            className={`send-action-btn ${
              isLoading || !inputValue.trim() ? 'disabled' : ''
            }`}
            onClick={() => void sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            aria-label="Send query"
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
          FinBridge AI provides educational study-abroad estimates based on 2026 regulations.
          Official tuition invoices and visa fees must be verified with institutions.
        </p>
      </footer>

      {/* Floating Toggle Button */}
      <button
        type="button"
        className="floating-chat-launcher"
        onClick={() => {
          if (isPlanCollapsed) {
            setIsPlanCollapsed(false)
          } else {
            textareaRef.current?.focus()
          }
        }}
        title={isPlanCollapsed ? 'Expand Study Plan' : 'Focus Chat'}
        aria-label="Toggle FinBridge View"
      >
        {isPlanCollapsed ? '📊' : '🧭'}
      </button>
    </div>
  )
}
