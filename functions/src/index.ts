import OpenAI from 'openai'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'

initializeApp()

const db = getFirestore()
const region = 'us-central1'
const openAiKey = defineSecret('OPENAI_API_KEY')
const openAiModel = defineString('OPENAI_MODEL', { default: 'gpt-5.4-mini' })

type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'any'

type ApplicationForm = {
  role?: string
  company?: string
  resume?: string
  jobDescription?: string
  tone?: string
}

type GeneratedAssets = {
  tailoredResume: string
  coverLetter: string
  matchNotes: string[]
  keywords: string[]
}

type JobFilters = {
  query?: string
  location?: string
  workMode?: WorkMode
  seniority?: string
  jobType?: string
  source?: string
  postedWithinDays?: number
  minSalary?: number
}

type Job = {
  id: string
  title: string
  company: string
  location: string
  workMode: WorkMode
  source: string
  url: string
  description: string
  salary?: string
  postedAt?: string
  tags: string[]
}

export const generateApplicationAssets = onCall(
  {
    region,
    secrets: [openAiKey],
    timeoutSeconds: 120,
    maxInstances: 8,
  },
  async (request): Promise<GeneratedAssets> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in before generating AI documents.')
    }

    const form = normalizeApplicationForm(request.data)
    const client = new OpenAI({ apiKey: openAiKey.value() })

    try {
      const response = await client.responses.create({
        model: openAiModel.value() || 'gpt-5.4-mini',
        reasoning: { effort: 'low' },
        instructions: [
          'You are an expert resume strategist and executive career writer.',
          'Create application materials that are truthful, specific, ATS-aware, and concise.',
          'Do not invent employers, degrees, certifications, metrics, or tools not present in the resume.',
          'If a requirement is not supported by the resume, frame it as adjacent experience in matchNotes.',
          'Return only JSON matching the requested schema.',
        ].join(' '),
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  role: form.role,
                  company: form.company,
                  resume: form.resume,
                  jobDescription: form.jobDescription,
                  tone: form.tone,
                  deliverables: [
                    'A tailored resume in clean plain text with sections and bullet points.',
                    'A cover letter addressed to the hiring team.',
                    'Match notes explaining the strongest alignment and gaps.',
                    'Keywords worth preserving for ATS alignment.',
                  ],
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'application_assets',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['tailoredResume', 'coverLetter', 'matchNotes', 'keywords'],
              properties: {
                tailoredResume: { type: 'string' },
                coverLetter: { type: 'string' },
                matchNotes: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 3,
                  maxItems: 8,
                },
                keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  minItems: 6,
                  maxItems: 18,
                },
              },
            },
          },
        },
      })

      const assets = parseAssets(response.output_text)

      await db.collection('users').doc(request.auth.uid).collection('aiRuns').add({
        role: form.role,
        company: form.company,
        assets,
        createdAt: FieldValue.serverTimestamp(),
      })

      return assets
    } catch (error) {
      console.error('generateApplicationAssets failed', error)
      throw new HttpsError('internal', 'AI generation failed. Check the Functions logs.')
    }
  },
)

export const searchJobs = onCall(
  {
    region,
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (request): Promise<{ jobs: Job[]; providers: string[] }> => {
    const filters = normalizeFilters(request.data)
    const providers: string[] = []

    const providerResults = await Promise.allSettled([
      fetchRemotiveJobs(filters),
      fetchAdzunaJobs(filters),
      fetchJSearchJobs(filters),
    ])

    const jobs = providerResults.flatMap((result) => {
      if (result.status === 'rejected') {
        console.warn('Job provider failed', result.reason)
        return []
      }

      if (result.value.jobs.length) {
        providers.push(result.value.provider)
      }
      return result.value.jobs
    })

    const filteredJobs = dedupeJobs(jobs)
      .filter((job) => filterJob(job, filters))
      .sort((a, b) => Date.parse(b.postedAt || '0') - Date.parse(a.postedAt || '0'))
      .slice(0, 80)

    if (request.auth) {
      await db.collection('users').doc(request.auth.uid).collection('jobSearches').add({
        filters,
        resultCount: filteredJobs.length,
        providers,
        createdAt: FieldValue.serverTimestamp(),
      })
    }

    return {
      jobs: filteredJobs,
      providers: providers.length ? providers : ['No configured providers returned roles'],
    }
  },
)

function normalizeApplicationForm(raw: ApplicationForm): Required<ApplicationForm> {
  const role = clean(raw.role, 120)
  const company = clean(raw.company, 120)
  const resume = clean(raw.resume, 20000)
  const jobDescription = clean(raw.jobDescription, 20000)
  const tone = clean(raw.tone, 80) || 'Confident and concise'

  if (!role || !company || resume.length < 80 || jobDescription.length < 80) {
    throw new HttpsError(
      'invalid-argument',
      'Role, company, resume, and job description are required.',
    )
  }

  return { role, company, resume, jobDescription, tone }
}

function normalizeFilters(raw: JobFilters): Required<JobFilters> {
  return {
    query: clean(raw.query, 160) || 'software',
    location: clean(raw.location, 120),
    workMode: normalizeWorkMode(raw.workMode),
    seniority: clean(raw.seniority, 60) || 'Any level',
    jobType: clean(raw.jobType, 60) || 'Full-time',
    source: clean(raw.source, 80) || 'All sources',
    postedWithinDays: clamp(Number(raw.postedWithinDays) || 30, 1, 90),
    minSalary: clamp(Number(raw.minSalary) || 0, 0, 1000000),
  }
}

async function fetchRemotiveJobs(filters: Required<JobFilters>) {
  const url = new URL('https://remotive.com/api/remote-jobs')
  url.searchParams.set('search', buildSearchQuery(filters))

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Remotive failed with ${response.status}`)
  }

  const data = (await response.json()) as {
    jobs?: Array<{
      id: number
      title: string
      company_name: string
      candidate_required_location?: string
      url: string
      description?: string
      publication_date?: string
      salary?: string
      tags?: string[]
      job_type?: string
    }>
  }

  return {
    provider: 'Remotive',
    jobs:
      data.jobs?.map<Job>((job) => ({
        id: `remotive-${job.id}`,
        title: stripHtml(job.title),
        company: stripHtml(job.company_name),
        location: job.candidate_required_location || 'Remote',
        workMode: 'remote',
        source: 'Remotive',
        url: job.url,
        description: stripHtml(job.description || '').slice(0, 650),
        salary: job.salary || undefined,
        postedAt: job.publication_date,
        tags: [job.job_type, ...(job.tags || [])].filter(Boolean).slice(0, 6) as string[],
      })) || [],
  }
}

async function fetchAdzunaJobs(filters: Required<JobFilters>) {
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY
  if (!appId || !appKey) {
    return { provider: 'Adzuna', jobs: [] as Job[] }
  }

  const countries = inferAdzunaCountries(filters.location)
  const responses = await Promise.all(
    countries.map(async (country) => {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`)
      url.searchParams.set('app_id', appId)
      url.searchParams.set('app_key', appKey)
      url.searchParams.set('results_per_page', '12')
      url.searchParams.set('what', buildSearchQuery(filters))
      if (filters.location && filters.workMode !== 'remote') {
        url.searchParams.set('where', filters.location)
      }
      url.searchParams.set('content-type', 'application/json')

      const response = await fetch(url)
      if (!response.ok) return []
      const data = (await response.json()) as {
        results?: Array<{
          id: string
          title: string
          company?: { display_name?: string }
          location?: { display_name?: string }
          redirect_url: string
          description?: string
          created?: string
          salary_min?: number
          salary_max?: number
          category?: { label?: string }
        }>
      }

      return (
        data.results?.map<Job>((job) => ({
          id: `adzuna-${country}-${job.id}`,
          title: stripHtml(job.title),
          company: stripHtml(job.company?.display_name || 'Unknown company'),
          location: job.location?.display_name || country.toUpperCase(),
          workMode: inferWorkMode(`${job.title} ${job.description} ${job.location?.display_name}`),
          source: 'Adzuna',
          url: job.redirect_url,
          description: stripHtml(job.description || '').slice(0, 650),
          salary: formatSalary(job.salary_min, job.salary_max),
          postedAt: job.created,
          tags: [job.category?.label, filters.jobType, filters.seniority].filter(Boolean) as string[],
        })) || []
      )
    }),
  )

  return {
    provider: 'Adzuna',
    jobs: responses.flat(),
  }
}

async function fetchJSearchJobs(filters: Required<JobFilters>) {
  const apiKey = process.env.JSEARCH_API_KEY
  if (!apiKey) {
    return { provider: 'JSearch', jobs: [] as Job[] }
  }

  const url = new URL('https://jsearch.p.rapidapi.com/search')
  url.searchParams.set('query', `${buildSearchQuery(filters)} ${filters.location}`.trim())
  url.searchParams.set('page', '1')
  url.searchParams.set('num_pages', '1')
  url.searchParams.set('date_posted', filters.postedWithinDays <= 7 ? 'week' : 'month')

  const response = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  })

  if (!response.ok) {
    throw new Error(`JSearch failed with ${response.status}`)
  }

  const data = (await response.json()) as {
    data?: Array<{
      job_id: string
      job_title: string
      employer_name: string
      job_city?: string
      job_country?: string
      job_is_remote?: boolean
      job_apply_link: string
      job_description?: string
      job_posted_at_datetime_utc?: string
      job_employment_type?: string
      job_min_salary?: number
      job_max_salary?: number
    }>
  }

  return {
    provider: 'JSearch',
    jobs:
      data.data?.map<Job>((job) => ({
        id: `jsearch-${job.job_id}`,
        title: stripHtml(job.job_title),
        company: stripHtml(job.employer_name),
        location: [job.job_city, job.job_country].filter(Boolean).join(', ') || 'Global',
        workMode: job.job_is_remote ? 'remote' : inferWorkMode(job.job_description || ''),
        source: 'JSearch',
        url: job.job_apply_link,
        description: stripHtml(job.job_description || '').slice(0, 650),
        salary: formatSalary(job.job_min_salary, job.job_max_salary),
        postedAt: job.job_posted_at_datetime_utc,
        tags: [job.job_employment_type, filters.seniority].filter(Boolean) as string[],
      })) || [],
  }
}

function filterJob(job: Job, filters: Required<JobFilters>) {
  if (filters.workMode !== 'any' && job.workMode !== filters.workMode) return false

  if (filters.location && filters.workMode !== 'remote') {
    const location = job.location.toLowerCase()
    if (!location.includes(filters.location.toLowerCase())) return false
  }

  const postedAt = job.postedAt ? Date.parse(job.postedAt) : 0
  if (postedAt) {
    const ageDays = (Date.now() - postedAt) / 86_400_000
    if (ageDays > filters.postedWithinDays) return false
  }

  return true
}

function dedupeJobs(jobs: Job[]) {
  const seen = new Set<string>()
  return jobs.filter((job) => {
    const key = `${job.title}-${job.company}-${job.location}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseAssets(outputText: string): GeneratedAssets {
  const parsed = JSON.parse(outputText || '{}') as Partial<GeneratedAssets>
  return {
    tailoredResume: String(parsed.tailoredResume || ''),
    coverLetter: String(parsed.coverLetter || ''),
    matchNotes: Array.isArray(parsed.matchNotes) ? parsed.matchNotes.map(String) : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
  }
}

function buildSearchQuery(filters: Required<JobFilters>) {
  return [filters.query, filters.seniority === 'Any level' ? '' : filters.seniority, filters.jobType]
    .filter(Boolean)
    .join(' ')
}

function clean(value: unknown, limit: number) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeWorkMode(value: unknown): WorkMode {
  if (value === 'remote' || value === 'hybrid' || value === 'onsite' || value === 'any') {
    return value
  }
  return 'any'
}

function inferWorkMode(text: string | undefined): WorkMode {
  const normalized = (text || '').toLowerCase()
  if (normalized.includes('hybrid')) return 'hybrid'
  if (normalized.includes('remote')) return 'remote'
  return 'onsite'
}

function inferAdzunaCountries(location: string) {
  const normalized = location.toLowerCase()
  const mappings: Record<string, string[]> = {
    remote: ['us', 'gb', 'ca', 'au', 'de'],
    global: ['us', 'gb', 'ca', 'au', 'de'],
    'united states': ['us'],
    usa: ['us'],
    canada: ['ca'],
    'united kingdom': ['gb'],
    uk: ['gb'],
    australia: ['au'],
    germany: ['de'],
    france: ['fr'],
    singapore: ['sg'],
    india: ['in'],
    netherlands: ['nl'],
  }

  for (const [key, countries] of Object.entries(mappings)) {
    if (normalized.includes(key)) return countries
  }

  return normalized ? ['us', 'gb', 'ca'] : ['us', 'gb', 'ca', 'au', 'de']
}

function formatSalary(min?: number, max?: number) {
  if (!min && !max) return undefined
  const format = (value: number) =>
    new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(value)
  if (min && max) return `${format(min)} - ${format(max)}`
  return format(min || max || 0)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
