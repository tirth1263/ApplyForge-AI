import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from './firebase'
import { mockJobs } from '../data/mockJobs'
import type {
  ApplicationForm,
  GeneratedAssets,
  Job,
  JobFilters,
  SavedApplication,
} from '../types'

const localApplicationsKey = 'applypilot.applications'
const localJobsKey = 'applypilot.savedJobs'

type GenerateResponse = GeneratedAssets
type SearchResponse = { jobs: Job[]; providers: string[] }

export async function generateApplicationAssets(
  form: ApplicationForm,
): Promise<GeneratedAssets> {
  if (functions) {
    const generate = httpsCallable<ApplicationForm, GenerateResponse>(
      functions,
      'generateApplicationAssets',
    )
    const response = await generate(form)
    return response.data
  }

  return buildLocalAssets(form)
}

export async function searchJobs(filters: JobFilters): Promise<SearchResponse> {
  if (functions) {
    const search = httpsCallable<JobFilters, SearchResponse>(functions, 'searchJobs')
    const response = await search(filters)
    return response.data
  }

  const normalizedQuery = filters.query.trim().toLowerCase()
  const normalizedLocation = filters.location.trim().toLowerCase()

  const jobs = mockJobs.filter((job) => {
    const matchesQuery =
      !normalizedQuery ||
      `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery)
    const matchesLocation =
      !normalizedLocation || job.location.toLowerCase().includes(normalizedLocation)
    const matchesMode = filters.workMode === 'any' || job.workMode === filters.workMode
    return matchesQuery && matchesLocation && matchesMode
  })

  return { jobs, providers: ['Local demo feed'] }
}

export async function saveApplication(
  userId: string | undefined,
  application: Omit<SavedApplication, 'id' | 'createdAt'>,
) {
  const payload = {
    ...application,
    createdAt: new Date().toISOString(),
  }

  if (userId && db) {
    await addDoc(collection(db, 'users', userId, 'applications'), {
      ...application,
      createdAt: serverTimestamp(),
    })
    return
  }

  const existing = readLocal<SavedApplication[]>(localApplicationsKey, [])
  const localEntry = {
    ...payload,
    id: crypto.randomUUID(),
  }
  localStorage.setItem(localApplicationsKey, JSON.stringify([localEntry, ...existing]))
}

export async function saveJob(userId: string | undefined, job: Job) {
  if (userId && db) {
    await addDoc(collection(db, 'users', userId, 'savedJobs'), {
      ...job,
      savedAt: serverTimestamp(),
    })
    return
  }

  const existing = readLocal<Job[]>(localJobsKey, [])
  const next = [job, ...existing.filter((saved) => saved.id !== job.id)]
  localStorage.setItem(localJobsKey, JSON.stringify(next.slice(0, 25)))
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function buildLocalAssets(form: ApplicationForm): GeneratedAssets {
  const role = form.role || 'Target Role'
  const company = form.company || 'the company'
  const keywords = extractKeywords(`${form.jobDescription} ${role}`).slice(0, 10)
  const keywordLine = keywords.length ? keywords.join(', ') : 'role-relevant achievements'

  return {
    tailoredResume: [
      `${role} Resume - Tailored for ${company}`,
      '',
      'Professional Summary',
      `Impact-focused candidate aligned to ${role} opportunities, with experience mapped to ${keywordLine}.`,
      '',
      'Selected Strengths',
      '- Translate role requirements into measurable execution priorities.',
      '- Communicate clearly with cross-functional teams and hiring stakeholders.',
      '- Turn ambiguous goals into organized, trackable outcomes.',
      '',
      'Experience Positioning',
      form.resume.trim()
        ? form.resume.trim()
        : 'Paste your base resume to let the AI rewrite bullets around the job description.',
    ].join('\n'),
    coverLetter: [
      `Dear ${company} Hiring Team,`,
      '',
      `I am excited to apply for the ${role} role. The position stands out because it calls for a blend of execution, judgment, and communication that matches the way I approach important work.`,
      '',
      `My background can be positioned around ${keywordLine}, and I would welcome the opportunity to bring that focus to ${company}. I am especially interested in contributing quickly, learning the team context, and helping convert priorities into visible outcomes.`,
      '',
      'Thank you for your time and consideration.',
      '',
      'Sincerely,',
      'Your Name',
    ].join('\n'),
    matchNotes: [
      'Local demo mode is active because Firebase Functions are not configured yet.',
      'Add Firebase environment variables and an OpenAI API key to generate fully personalized outputs.',
      'Paste a detailed job description for stronger keyword alignment.',
    ],
    keywords,
  }
}

function extractKeywords(text: string) {
  const stopWords = new Set([
    'and',
    'the',
    'with',
    'for',
    'you',
    'your',
    'our',
    'that',
    'this',
    'from',
    'will',
    'are',
    'role',
    'job',
    'work',
    'team',
  ])

  const counts = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .reduce<Record<string, number>>((acc, word) => {
      acc[word] = (acc[word] || 0) + 1
      return acc
    }, {})

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
}
