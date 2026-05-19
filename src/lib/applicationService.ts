import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTaskSnapshot,
} from 'firebase/storage'
import { db, functions, storage } from './firebase'
import type {
  ApplicationForm,
  ApplicationStatus,
  GeneratedAssets,
  Job,
  JobFilters,
  ResumeUpload,
  SavedApplication,
  SavedJob,
  UserProfile,
} from '../types'

const localApplicationsKey = 'applyforge.applications'
const localJobsKey = 'applyforge.savedJobs'
const localProfileKey = 'applyforge.profile'

type GenerateResponse = GeneratedAssets
type SearchResponse = { jobs: Job[]; providers: string[] }
type ProviderResult = { provider: string; jobs: Job[] }

export const emptyProfile: UserProfile = {
  fullName: '',
  headline: '',
  targetRoles: '',
  preferredLocations: '',
  portfolioUrl: '',
  masterResume: '',
}

export function subscribeToUserProfile(
  userId: string | undefined,
  onChange: (profile: UserProfile | null) => void,
) {
  if (!userId || !db) {
    onChange(readLocal<UserProfile | null>(localProfileKey, null))
    return () => undefined
  }

  return onSnapshot(doc(db, 'users', userId), (snapshot) => {
    onChange(snapshot.exists() ? normalizeProfile(snapshot.data()) : null)
  })
}

export function subscribeToSavedJobs(
  userId: string | undefined,
  onChange: (jobs: SavedJob[]) => void,
) {
  if (!userId || !db) {
    onChange(readLocal<SavedJob[]>(localJobsKey, []))
    return () => undefined
  }

  return onSnapshot(
    query(collection(db, 'users', userId, 'savedJobs'), orderBy('savedAt', 'desc')),
    (snapshot) => onChange(snapshot.docs.map(normalizeSavedJob)),
  )
}

export function subscribeToApplications(
  userId: string | undefined,
  onChange: (applications: SavedApplication[]) => void,
) {
  if (!userId || !db) {
    onChange(readLocal<SavedApplication[]>(localApplicationsKey, []))
    return () => undefined
  }

  return onSnapshot(
    query(collection(db, 'users', userId, 'applications'), orderBy('createdAt', 'desc')),
    (snapshot) => onChange(snapshot.docs.map(normalizeApplication)),
  )
}

export async function saveUserProfile(userId: string | undefined, profile: UserProfile) {
  const payload = {
    ...profile,
    updatedAt: new Date().toISOString(),
  }

  if (userId && db) {
    await setDoc(
      doc(db, 'users', userId),
      {
        ...profile,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
    return
  }

  localStorage.setItem(localProfileKey, JSON.stringify(payload))
}

export async function uploadResumeFile(
  userId: string | undefined,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ResumeUpload> {
  if (!userId || !storage) {
    throw new Error('Sign in with Google before uploading resume files.')
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const fileRef = ref(storage, `users/${userId}/resumes/${Date.now()}-${safeName}`)
  const task = uploadBytesResumable(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
  })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snapshot: UploadTaskSnapshot) => {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        resolve({ fileName: file.name, url })
      },
    )
  })
}

export async function generateApplicationAssets(
  form: ApplicationForm,
): Promise<GeneratedAssets> {
  if (functions) {
    try {
      const generate = httpsCallable<ApplicationForm, GenerateResponse>(
        functions,
        'generateApplicationAssets',
      )
      const response = await generate(form)
      return response.data
    } catch (error) {
      console.warn('Falling back to local application generator', error)
    }
  }

  return buildLocalAssets(form)
}

export async function searchJobs(filters: JobFilters): Promise<SearchResponse> {
  const realJobs = await searchPublicJobSources(filters)
  if (realJobs.jobs.length) {
    return realJobs
  }

  if (functions) {
    try {
      const search = httpsCallable<JobFilters, SearchResponse>(functions, 'searchJobs')
      const response = await search(filters)
      return response.data
    } catch (error) {
      console.warn('Falling back to local job search', error)
    }
  }

  return { jobs: [], providers: ['No real jobs returned from connected sources'] }
}

export async function saveApplication(
  userId: string | undefined,
  application: Omit<SavedApplication, 'id' | 'createdAt' | 'status'> & {
    status?: ApplicationStatus
  },
) {
  const payload: Omit<SavedApplication, 'id'> = {
    ...application,
    status: application.status || 'Tailored',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  if (userId && db) {
    await addDoc(collection(db, 'users', userId, 'applications'), {
      ...application,
      status: application.status || 'Tailored',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
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
  const savedJob: SavedJob = {
    ...job,
    savedAt: new Date().toISOString(),
    status: 'Saved',
  }

  if (userId && db) {
    const jobRef = doc(db, 'users', userId, 'savedJobs', job.id)
    const existing = await getDoc(jobRef)
    await setDoc(
      jobRef,
      {
        ...job,
        savedAt: existing.exists() ? existing.data().savedAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: existing.exists() ? existing.data().status || 'Saved' : 'Saved',
      },
      { merge: true },
    )
    return
  }

  const existing = readLocal<SavedJob[]>(localJobsKey, [])
  const next = [savedJob, ...existing.filter((saved) => saved.id !== job.id)]
  localStorage.setItem(localJobsKey, JSON.stringify(next.slice(0, 50)))
}

export async function updateSavedJobStatus(
  userId: string | undefined,
  jobId: string,
  status: ApplicationStatus,
) {
  if (userId && db) {
    await updateDoc(doc(db, 'users', userId, 'savedJobs', jobId), {
      status,
      updatedAt: serverTimestamp(),
    })
    return
  }

  const existing = readLocal<SavedJob[]>(localJobsKey, [])
  localStorage.setItem(
    localJobsKey,
    JSON.stringify(existing.map((job) => (job.id === jobId ? { ...job, status } : job))),
  )
}

export async function updateApplicationStatus(
  userId: string | undefined,
  applicationId: string,
  status: ApplicationStatus,
) {
  if (userId && db) {
    await updateDoc(doc(db, 'users', userId, 'applications', applicationId), {
      status,
      updatedAt: serverTimestamp(),
    })
    return
  }

  const existing = readLocal<SavedApplication[]>(localApplicationsKey, [])
  localStorage.setItem(
    localApplicationsKey,
    JSON.stringify(
      existing.map((application) =>
        application.id === applicationId
          ? { ...application, status, updatedAt: new Date().toISOString() }
          : application,
      ),
    ),
  )
}

export async function deleteSavedJob(userId: string | undefined, jobId: string) {
  if (userId && db) {
    await deleteDoc(doc(db, 'users', userId, 'savedJobs', jobId))
    return
  }

  const existing = readLocal<SavedJob[]>(localJobsKey, [])
  localStorage.setItem(localJobsKey, JSON.stringify(existing.filter((job) => job.id !== jobId)))
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

async function searchPublicJobSources(filters: JobFilters): Promise<SearchResponse> {
  const results = await Promise.allSettled([
    fetchRemotiveJobs(filters),
    fetchArbeitnowJobs(),
  ])

  const providers: string[] = []
  const jobs = results.flatMap((result) => {
    if (result.status === 'rejected') {
      console.warn('Real job provider failed', result.reason)
      return []
    }

    if (result.value.jobs.length) providers.push(result.value.provider)
    return result.value.jobs
  })

  return {
    jobs: dedupeJobs(jobs)
      .filter((job) => filterRealJob(job, filters))
      .sort((a, b) => Date.parse(b.postedAt || '0') - Date.parse(a.postedAt || '0'))
      .slice(0, 250),
    providers,
  }
}

async function fetchRemotiveJobs(filters: JobFilters): Promise<ProviderResult> {
  const url = new URL('https://remotive.com/api/remote-jobs')
  url.searchParams.set('limit', '120')
  if (filters.query.trim()) {
    url.searchParams.set('search', filters.query.trim())
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Remotive failed with ${response.status}`)

  const data = (await response.json()) as {
    jobs?: Array<{
      id: number
      url: string
      title: string
      company_name: string
      category?: string
      tags?: string[]
      job_type?: string
      publication_date?: string
      candidate_required_location?: string
      salary?: string
      description?: string
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
        description: stripHtml(job.description || '').slice(0, 760),
        salary: job.salary || undefined,
        postedAt: job.publication_date,
        tags: [job.category, job.job_type, ...(job.tags || [])].filter(Boolean).slice(0, 7) as string[],
      })) || [],
  }
}

async function fetchArbeitnowJobs(): Promise<ProviderResult> {
  const response = await fetch('https://www.arbeitnow.com/api/job-board-api')
  if (!response.ok) throw new Error(`Arbeitnow failed with ${response.status}`)

  const data = (await response.json()) as {
    data?: Array<{
      slug: string
      company_name: string
      title: string
      description?: string
      remote?: boolean
      url: string
      tags?: string[]
      job_types?: string[]
      location?: string
      created_at?: number
    }>
  }

  return {
    provider: 'Arbeitnow',
    jobs:
      data.data?.map<Job>((job) => {
        const description = stripHtml(job.description || '')
        return {
          id: `arbeitnow-${job.slug}`,
          title: stripHtml(job.title),
          company: stripHtml(job.company_name),
          location: job.location || (job.remote ? 'Remote' : 'Europe'),
          workMode: job.remote ? 'remote' : inferWorkMode(`${job.location} ${description}`),
          source: 'Arbeitnow',
          url: job.url,
          description: description.slice(0, 760),
          postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : undefined,
          tags: [...(job.job_types || []), ...(job.tags || [])].filter(Boolean).slice(0, 7),
        }
      }) || [],
  }
}

function filterRealJob(job: Job, filters: JobFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const normalizedLocation = filters.location.trim().toLowerCase()
  const normalizedType = filters.jobType.trim().toLowerCase()
  const normalizedSource = filters.source.trim().toLowerCase()

  const haystack = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`
    .toLowerCase()
    .trim()

  if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
  if (filters.workMode !== 'any' && job.workMode !== filters.workMode) return false
  if (normalizedSource !== 'all sources' && job.source.toLowerCase() !== normalizedSource) {
    return false
  }

  if (normalizedLocation && normalizedLocation !== 'remote') {
    const locationHaystack = `${job.location} ${job.description}`.toLowerCase()
    if (!locationHaystack.includes(normalizedLocation)) return false
  }

  if (normalizedType && normalizedType !== 'all types') {
    const typeHaystack = `${job.tags.join(' ')} ${job.description}`.toLowerCase()
    if (!typeHaystack.includes(normalizedType.replace('-', '_')) && !typeHaystack.includes(normalizedType)) {
      return false
    }
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

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x26;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function inferWorkMode(text: string): Job['workMode'] {
  const normalized = text.toLowerCase()
  if (normalized.includes('hybrid')) return 'hybrid'
  if (normalized.includes('remote')) return 'remote'
  return 'onsite'
}

function buildLocalAssets(form: ApplicationForm): GeneratedAssets {
  const role = form.role || 'Target Role'
  const company = form.company || 'the company'
  const keywords = extractKeywords(`${form.jobDescription} ${role}`).slice(0, 12)
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
      form.company ? 'Your Name' : '',
    ].join('\n'),
    matchNotes: [
      'Local demo mode is active because Firebase Functions are not configured yet.',
      'Add the OpenAI Functions secret and deploy Functions for production-quality rewriting.',
      'Paste a detailed job description for stronger keyword alignment.',
    ],
    keywords,
  }
}

function normalizeProfile(data: DocumentData): UserProfile {
  return {
    ...emptyProfile,
    fullName: String(data.fullName || ''),
    headline: String(data.headline || ''),
    targetRoles: String(data.targetRoles || ''),
    preferredLocations: String(data.preferredLocations || ''),
    portfolioUrl: String(data.portfolioUrl || ''),
    masterResume: String(data.masterResume || ''),
    resumeFileName: data.resumeFileName ? String(data.resumeFileName) : undefined,
    resumeFileUrl: data.resumeFileUrl ? String(data.resumeFileUrl) : undefined,
    updatedAt: toIso(data.updatedAt),
  }
}

function normalizeSavedJob(snapshot: QueryDocumentSnapshot<DocumentData>): SavedJob {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    title: String(data.title || ''),
    company: String(data.company || ''),
    location: String(data.location || ''),
    workMode: data.workMode || 'any',
    source: String(data.source || ''),
    url: String(data.url || ''),
    description: String(data.description || ''),
    salary: data.salary ? String(data.salary) : undefined,
    postedAt: data.postedAt ? String(data.postedAt) : undefined,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    savedAt: toIso(data.savedAt),
    status: normalizeStatus(data.status),
    notes: data.notes ? String(data.notes) : undefined,
  }
}

function normalizeApplication(snapshot: QueryDocumentSnapshot<DocumentData>): SavedApplication {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    role: String(data.role || ''),
    company: String(data.company || ''),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    status: normalizeStatus(data.status || 'Tailored'),
    jobId: data.jobId ? String(data.jobId) : undefined,
    job: data.job as Job | undefined,
    assets: {
      tailoredResume: String(data.assets?.tailoredResume || ''),
      coverLetter: String(data.assets?.coverLetter || ''),
      matchNotes: Array.isArray(data.assets?.matchNotes) ? data.assets.matchNotes.map(String) : [],
      keywords: Array.isArray(data.assets?.keywords) ? data.assets.keywords.map(String) : [],
    },
    notes: data.notes ? String(data.notes) : undefined,
  }
}

function normalizeStatus(value: unknown): ApplicationStatus {
  const status = String(value || 'Saved')
  if (
    status === 'Saved' ||
    status === 'Tailored' ||
    status === 'Applied' ||
    status === 'Interview' ||
    status === 'Offer' ||
    status === 'Rejected'
  ) {
    return status
  }
  return 'Saved'
}

function toIso(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
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
