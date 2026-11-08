/**
 * FinBridge AI Study Abroad Finance Advisor — Client-Side Gemini Engine
 *
 * Implements safe, defensive API key resolution and direct Google Gemini API
 * connectivity for standalone GitHub Pages deployments.
 */

import type { FinancialContext } from './AIAdvisor'

export interface CalculationSummary {
  totalEstimatedCost?: number
  totalTuition?: number
  totalLiving?: number
  initialExpenses?: number
  convertedAvailableFunds?: number
  fundingGap?: number
  coveragePct?: number
  destCurrency?: string
  homeCurrency?: string
  assumedFields?: string[]
  isEstimate?: boolean
}

export interface ClientAiResponse {
  reply: string
  mode: 'real' | 'mock'
  model?: string
  calculations?: CalculationSummary
  error?: string
}

/**
 * FIX 1: Defensive API key reader
 * Safely checks import.meta.env without crashing, then falls back to localStorage.
 * NEVER accesses process.env directly in browser code.
 */
export const getApiKey = (): string => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const envKey =
        import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY
      if (envKey && typeof envKey === 'string' && envKey.trim() !== '') {
        return envKey.trim()
      }
    }
  } catch (_) {}

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = localStorage.getItem('FINBRIDGE_GEMINI_API_KEY')
      if (stored && typeof stored === 'string' && stored.trim() !== '') {
        return stored.trim()
      }
    }
  } catch (_) {}

  return ''
}

export const setApiKey = (key: string): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const trimmed = key.trim()
      if (trimmed) {
        localStorage.setItem('FINBRIDGE_GEMINI_API_KEY', trimmed)
      } else {
        localStorage.removeItem('FINBRIDGE_GEMINI_API_KEY')
      }
    }
  } catch (_) {}
}

export const clearApiKey = (): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('FINBRIDGE_GEMINI_API_KEY')
    }
  } catch (_) {}
}

export const hasApiKey = (): boolean => {
  return Boolean(getApiKey())
}

const SYSTEM_INSTRUCTION = `
You are FinBridge, a practical AI study-abroad and student finance advisor.

YOUR PRIMARY GOAL:
Answer the user's actual question accurately, directly, and helpfully.

RESPONSE RULES:
1. Start with the direct answer in the first 1-2 sentences.
2. Do not begin every answer with an introduction or assumptions section.
3. Never invent the user's country, city, currency, university, or financial status.
4. If location is missing and not specified in the context, provide a useful general answer first, then ask one brief follow-up question if local details would help.
5. For simple questions, keep the answer focused. For complex budgeting questions, provide organized details.
6. Match the language of the user's question (e.g. reply in Bangla when asked in Bangla, English when asked in English).
7. Distinguish facts from estimates. Never present an assumption as a confirmed quote.
8. When estimating student part-time income, explain typical hourly wage, weekly working hour limits (e.g. 20 hrs/week during term), monthly gross, and practical living cost offset.
9. Never guarantee a visa, job, or scholarship.
10. Use readable paragraphs and clear bullet points. Educational guidance only — not official financial advice.
`.trim()

/**
 * Client-side calculation engine matching the backend FinBridge logic.
 */
export function calculateClientFinances(
  context?: FinancialContext,
): CalculationSummary | undefined {
  if (!context) return undefined

  try {
    const months = Math.max(1, Number(context.studyDurationMonths) || 24)
    const tuitionYear = Math.max(0, Number(context.tuitionPerYear) || 0)
    const monthlyLiving = Math.max(0, Number(context.monthlyLiving) || 0)
    const initial = Math.max(0, Number(context.initialExpenses) || 0)
    const funds = Math.max(0, Number(context.availableFunds) || 0)
    const rate = Math.max(0.00000001, Number(context.exchangeRate) || 1)

    const totalTuition = (tuitionYear * months) / 12
    const totalLiving = monthlyLiving * months
    const totalEstimatedCost = totalTuition + totalLiving + initial
    const convertedAvailableFunds = funds * rate
    const fundingGap = Math.max(0, totalEstimatedCost - convertedAvailableFunds)
    const coveragePct =
      totalEstimatedCost > 0
        ? Math.min(
            100,
            Math.round((convertedAvailableFunds / totalEstimatedCost) * 100),
          )
        : 0

    return {
      totalEstimatedCost: Math.round(totalEstimatedCost),
      totalTuition: Math.round(totalTuition),
      totalLiving: Math.round(totalLiving),
      initialExpenses: Math.round(initial),
      convertedAvailableFunds: Math.round(convertedAvailableFunds),
      fundingGap: Math.round(fundingGap),
      coveragePct,
      destCurrency: context.destCurrency || 'CAD',
      homeCurrency: context.homeCurrency || 'BDT',
      isEstimate: true,
    }
  } catch (_) {
    return undefined
  }
}

/**
 * Validate an API key by making a minimal test call to Gemini.
 */
export async function testGeminiKey(
  keyToTest?: string,
): Promise<{ success: boolean; model?: string; message: string }> {
  const key = (keyToTest ?? getApiKey()).trim()
  if (!key) {
    return { success: false, message: 'No API key provided.' }
  }

  const model = 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    key,
  )}`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: 'FinBridge test ping. Reply "OK".' }] },
        ],
        generationConfig: { maxOutputTokens: 10, temperature: 0.1 },
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const msg =
        errData.error?.message ||
        `Google API returned error status ${res.status}`
      return { success: false, message: msg }
    }

    return {
      success: true,
      model,
      message: `Gemini API key is active and ready (${model}).`,
    }
  } catch (err) {
    return {
      success: false,
      message:
        err instanceof Error
          ? err.message
          : 'Network error connecting to Gemini API.',
    }
  }
}

/**
 * Built-in intelligent educational advisor response when no Gemini API key is configured.
 * Ensures the chatbot NEVER fails or leaves the user hanging.
 */
function generateEducationalFallback(
  message: string,
  context?: FinancialContext,
  calculations?: CalculationSummary,
): string {
  const q = message.toLowerCase()

  if (q.includes('save') || q.includes('first semester')) {
    const dest = context ? context.destination : 'your study destination'
    const curr = context ? context.destCurrency : 'CAD/USD'
    return (
      `For your first semester in **${dest}**, you should target having at least **1 full semester of tuition plus 4 to 6 months of living expenses** readily liquid before flying.\n\n` +
      `**Recommended Pre-Departure Savings Checklist:**\n` +
      `• **Tuition Reserve:** ~50% of your annual tuition (~${curr} ${context ? (context.tuitionPerYear / 2).toLocaleString() : '15,000 - 25,000'}).\n` +
      `• **Initial Landing & Setup:** ~${curr} ${context ? context.initialExpenses.toLocaleString() : '3,500 - 5,000'} for security deposit, flight, initial transit, and winter/setup essentials.\n` +
      `• **Living Buffer:** At least 3 months of living costs (${curr} ${context ? (context.monthlyLiving * 3).toLocaleString() : '4,500 - 6,000'}) so you are not dependent on finding a job immediately.\n\n` +
      `💡 *Tip: To enable real-time personalized AI responses, click the **🔑 API Key** button in the header.*`
    )
  }

  if (q.includes('housing') || q.includes('rent') || q.includes('living')) {
    const curr = context ? context.destCurrency : 'local currency'
    const monthly = context ? context.monthlyLiving : 1600
    return (
      `Housing typically represents **55% to 70%** of an international student's monthly living budget.\n\n` +
      `**Current Budget Analysis:**\n` +
      `• Your allocated monthly living budget is **${curr} ${monthly.toLocaleString()}**.\n` +
      `• A healthy housing allocation is typically **${curr} ${Math.round(monthly * 0.6).toLocaleString()}** for a shared apartment or student residence.\n` +
      `• If private rentals in your target city exceed 70% of this budget, consider shared accommodation (roommates), university homestays, or locations with reliable transit access further from downtown.\n\n` +
      `💡 *Tip: Connect your Google Gemini API key via the **🔑 API Key** button to explore live city-specific rent benchmarks.*`
    )
  }

  if (q.includes('exchange rate') || q.includes('currency')) {
    const home = context ? context.homeCurrency : 'home currency'
    const dest = context ? context.destCurrency : 'study currency'
    const rate = context ? context.exchangeRate : 0.01
    return (
      `Exchange rate fluctuations are one of the biggest hidden risks in international education finance.\n\n` +
      `**Impact on Your Budget:**\n` +
      `• With your current planning rate of **1 ${home} = ${rate} ${dest}**, your savings translate to **${dest} ${calculations?.convertedAvailableFunds?.toLocaleString() ?? 'N/A'}**.\n` +
      `• A mere **5% to 10% currency depreciation** in your home currency would widen your funding gap by several thousand ${dest}.\n\n` +
      `**Protection Strategies:**\n` +
      `1. **Tranche Transfers:** Convert funds when favorable rather than waiting for fee deadlines.\n` +
      `2. **Tuition Lock-In:** Pay full annual tuition early if your university allows discounts or locks in term rates.\n` +
      `3. **Multi-Currency Student Accounts:** Hold funds in ${dest} to shield against ongoing volatility.\n\n` +
      `💡 *Tip: Add your Gemini API key in the header to ask detailed transfer timing questions.*`
    )
  }

  if (q.includes('income') || q.includes('part-time') || q.includes('job') || q.includes('work')) {
    const dest = context ? context.destination : 'your destination'
    const curr = context ? context.destCurrency : 'local currency'
    return (
      `Realistic student part-time earnings depend heavily on immigration labor laws in **${dest}**.\n\n` +
      `**Standard Student Work Parameters:**\n` +
      `• **Term-Time Limit:** Most countries (Canada, UK, Australia, US on-campus) cap student employment at **20 hours per week** during study semesters.\n` +
      `• **Typical Hourly Wage:** Usually minimum wage to standard entry wages (**${curr} 15 - ${curr} 24/hr** depending on city).\n` +
      `• **Realistic Monthly Gross:** Working 20 hrs/week at average rates yields approximately **${curr} 1,200 - ${curr} 1,800/month** before taxes.\n` +
      `• **Living Cost Offset:** Part-time work can comfortably cover grocery and personal spending, but **should never be relied upon to pay main tuition installments**.\n\n` +
      `💡 *Tip: Activate your free Gemini API key using the **🔑 API Key** button for specific work regulations.*`
    )
  }

  if (q.includes('gap') || q.includes('funding') || q.includes('plan') || q.includes('evaluate')) {
    if (context && calculations) {
      return (
        `Here is an evaluation of your current study plan for **${context.university}** in **${context.destination}**:\n\n` +
        `**Key Metrics:**\n` +
        `• **Estimated Total Cost (${context.studyDurationMonths} mo):** ${context.destCurrency} ${calculations.totalEstimatedCost?.toLocaleString()}\n` +
        `• **Total Tuition:** ${context.destCurrency} ${calculations.totalTuition?.toLocaleString()}\n` +
        `• **Total Living & Setup:** ${context.destCurrency} ${((calculations.totalLiving ?? 0) + (calculations.initialExpenses ?? 0)).toLocaleString()}\n` +
        `• **Available Funds:** ${context.destCurrency} ${calculations.convertedAvailableFunds?.toLocaleString()} (${context.availableFunds.toLocaleString()} ${context.homeCurrency})\n` +
        `• **Funding Gap:** ${context.destCurrency} ${calculations.fundingGap?.toLocaleString()} (${calculations.coveragePct}% covered)\n\n` +
        (calculations.fundingGap && calculations.fundingGap > 0
          ? `**Recommendations to Close the ${context.destCurrency} ${calculations.fundingGap.toLocaleString()} Gap:**\n` +
            `1. **International Student Education Loans:** Inquire with non-cosigner lenders (e.g. Prodigy, MPOWER) or national education banks in your home country.\n` +
            `2. **Departmental & Faculty Scholarships:** Apply early for academic merit and international student bursaries.\n` +
            `3. **On-Campus & Graduate Assistantships:** Research teaching/research assistant roles which often provide tuition waivers.\n`
          : `🎉 **Congratulations!** Your current available funds fully cover your projected total cost with a surplus of ${context.destCurrency} ${((calculations.convertedAvailableFunds ?? 0) - (calculations.totalEstimatedCost ?? 0)).toLocaleString()}. Make sure to keep emergency reserves intact.`) +
        `\n\n💡 *Tip: Click **🔑 API Key** in the header to enable full generative AI consultation with live Gemini.*`
      )
    }
  }

  // General fallback guidance
  return (
    `Thank you for your question about study-abroad financing!\n\n` +
    `As your **FinBridge Finance Advisor**, here are important principles to keep in mind:\n` +
    `• **Plan 1.25x Budget:** Always budget an extra 20-25% buffer above official university estimates for healthcare, textbook licenses, and winter/relocation setup.\n` +
    `• **Visa Proof of Funds:** Immigration officers require proof of liquid funds (tuition + first year living) held for a specified duration in approved bank accounts.\n` +
    `• **Currency Hedging:** Monitor exchange rates and transfer funds when your home currency is performing well.\n\n` +
    `To get dynamic, customized answers generated directly by Google Gemini AI, please click the **🔑 API Key** button in the header and paste your free Google AI Studio key.`
  )
}

/**
 * Generate client-side AI response directly via Google Gemini API (or educational fallback).
 * NEVER crashes when API key is missing or invalid.
 */
export async function generateClientAiResponse(
  message: string,
  context?: FinancialContext,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<ClientAiResponse> {
  const calculations = calculateClientFinances(context)
  const apiKey = getApiKey()

  // If no API key provided, supply intelligent educational advice
  if (!apiKey) {
    const fallbackText = generateEducationalFallback(message, context, calculations)
    return {
      reply: fallbackText,
      mode: 'mock',
      calculations,
    }
  }

  // Format context for prompt
  let contextBlock = ''
  if (context && calculations) {
    contextBlock = `\n[STUDENT FINANCIAL PROFILE CONTEXT]:
Destination: ${context.destination}
University: ${context.university}
Duration: ${context.studyDurationMonths} months
Tuition per Year: ${context.destCurrency} ${context.tuitionPerYear}
Monthly Living: ${context.destCurrency} ${context.monthlyLiving}
Initial Setup Expenses: ${context.destCurrency} ${context.initialExpenses}
Available Savings: ${context.availableFunds} ${context.homeCurrency}
Exchange Rate: 1 ${context.homeCurrency} = ${context.exchangeRate} ${context.destCurrency}
Total Estimated Cost: ${context.destCurrency} ${calculations.totalEstimatedCost}
Converted Savings: ${context.destCurrency} ${calculations.convertedAvailableFunds}
Funding Gap: ${context.destCurrency} ${calculations.fundingGap} (${calculations.coveragePct}% covered)
`
  }

  // Prepare Gemini conversation payload
  const model = 'gemini-2.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    apiKey,
  )}`

  // Build clean contents list from history
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  // Add recent history (up to last 6 messages to stay fast and lightweight)
  const recentHistory = history.slice(-6)
  for (const h of recentHistory) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })
  }

  // Add current prompt
  const fullPrompt = contextBlock
    ? `${contextBlock}\nUser Question: ${message}`
    : message

  contents.push({
    role: 'user',
    parts: [{ text: fullPrompt }],
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.4,
        },
      }),
    })

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}))
      const errorMsg =
        errorJson.error?.message ||
        `Gemini API returned HTTP status ${res.status}`
      console.warn('Gemini API call failed:', errorMsg)

      // Fallback with polite notice
      const fallbackText = generateEducationalFallback(
        message,
        context,
        calculations,
      )
      return {
        reply: `${fallbackText}\n\n*(Note: Gemini live response encountered an issue: ${errorMsg}. Using offline educational advisor mode.)*`,
        mode: 'mock',
        calculations,
        error: errorMsg,
      }
    }

    const data = await res.json()
    const candidate = data.candidates?.[0]
    const textPart = candidate?.content?.parts?.[0]?.text

    if (!textPart) {
      throw new Error('Gemini API returned an empty response.')
    }

    return {
      reply: textPart,
      mode: 'real',
      model,
      calculations,
    }
  } catch (err) {
    console.error('Error during client-side Gemini generation:', err)
    const fallbackText = generateEducationalFallback(
      message,
      context,
      calculations,
    )
    return {
      reply: `${fallbackText}\n\n*(Note: Could not reach Gemini directly from browser: ${
        err instanceof Error ? err.message : 'Network error'
      }. Showing educational guide.)*`,
      mode: 'mock',
      calculations,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}

