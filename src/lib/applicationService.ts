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
type NormalizedLocationFilter = {
  locationQuery: string
  aliases: string[]
  region?: 'us'
}

const US_STATE_NAMES = [
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'district of columbia',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
]

const US_STATE_CODE_PATTERN =
  /(?:^|[\s,;()/.-])(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?:$|[\s,;()/.-])/i

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
    onChange(readLocal<SavedJob[]>(localJobsKey, []).filter(isAllowedUsEnglishJob))
    return () => undefined
  }

  return onSnapshot(
    query(collection(db, 'users', userId, 'savedJobs'), orderBy('savedAt', 'desc')),
    (snapshot) => onChange(snapshot.docs.map(normalizeSavedJob).filter(isAllowedUsEnglishJob)),
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
  return searchPublicJobSources({
    ...filters,
    location: 'United States',
  })
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

export function isAllowedUsEnglishJob(job: Job) {
  return matchesLocationFilter(job, normalizeLocationFilter('United States')) && isEnglishJob(job)
}

async function searchPublicJobSources(filters: JobFilters): Promise<SearchResponse> {
  const results = await Promise.allSettled([
    fetchTheMuseJobs(filters),
    fetchRemotiveJobs(filters),
  ])

  const jobs = results.flatMap((result) => {
    if (result.status === 'rejected') {
      console.warn('Real job provider failed', result.reason)
      return []
    }

    return result.value.jobs
  })

  const filteredJobs = dedupeJobs(jobs)
    .filter((job) => filterRealJob(job, filters))
    .filter(isAllowedUsEnglishJob)
    .sort((a, b) => Date.parse(b.postedAt || '0') - Date.parse(a.postedAt || '0'))
    .slice(0, 500)
  const providers = Array.from(new Set(filteredJobs.map((job) => job.source)))

  return {
    jobs: filteredJobs,
    providers: providers.length ? providers : ['No US English roles returned from connected sources'],
  }
}

async function fetchTheMuseJobs(filters: JobFilters): Promise<ProviderResult> {
  const pages = Array.from({ length: 8 }, (_, index) => index + 1)
  const normalizedLocation = normalizeLocationFilter(filters.location)

  const responses = await Promise.all(
    pages.map(async (page) => {
      const url = new URL('https://www.themuse.com/api/public/jobs')
      url.searchParams.set('page', String(page))
      if (filters.query.trim()) {
        url.searchParams.set('search', filters.query.trim())
      }
      if (normalizedLocation.locationQuery) {
        url.searchParams.set('location', normalizedLocation.locationQuery)
      }

      const response = await fetch(url)
      if (!response.ok) throw new Error(`The Muse failed with ${response.status}`)
      return response.json() as Promise<{
        results?: Array<{
          id: number
          name: string
          contents?: string
          publication_date?: string
          locations?: Array<{ name: string }>
          categories?: Array<{ name: string }>
          levels?: Array<{ name: string; short_name?: string }>
          tags?: Array<{ name?: string } | string>
          refs?: { landing_page?: string }
          company?: { name?: string }
        }>
      }>
    }),
  )

  return {
    provider: 'The Muse',
    jobs: responses.flatMap((data) =>
      (data.results || []).map<Job>((job) => {
        const description = stripHtml(job.contents || '')
        const locations = job.locations?.map((location) => location.name).filter(Boolean) || []
        const displayLocation =
          locations.length === 1 && locations[0].toLowerCase() === 'flexible / remote'
            ? 'United States Remote'
            : locations.join(', ') || 'United States'
        const levels = job.levels?.map((level) => level.name).filter(Boolean) || []
        const categories = job.categories?.map((category) => category.name).filter(Boolean) || []
        const tags =
          job.tags?.map((tag) => (typeof tag === 'string' ? tag : tag.name || '')).filter(Boolean) ||
          []

        return {
          id: `themuse-${job.id}`,
          title: stripHtml(job.name),
          company: stripHtml(job.company?.name || 'Company not listed'),
          location: displayLocation,
          workMode: inferWorkMode(`${job.name} ${locations.join(' ')} ${description}`),
          source: 'The Muse',
          url: job.refs?.landing_page || `https://www.themuse.com/jobs/${job.id}`,
          description: description.slice(0, 760),
          postedAt: job.publication_date,
          tags: [...categories, ...levels, ...tags].slice(0, 7),
        }
      }),
    ),
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

function filterRealJob(job: Job, filters: JobFilters) {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const normalizedLocation = normalizeLocationFilter(filters.location)
  const normalizedSource = filters.source.trim().toLowerCase()

  const haystack = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`
    .toLowerCase()
    .trim()

  if (normalizedQuery && !haystack.includes(normalizedQuery)) return false
  if (filters.workMode !== 'any' && job.workMode !== filters.workMode) return false
  if (normalizedSource !== 'all sources' && job.source.toLowerCase() !== normalizedSource) {
    return false
  }

  if (!matchesLocationFilter(job, normalizedLocation)) return false
  if (!matchesSeniorityFilter(job, filters.seniority)) return false
  if (!matchesJobTypeFilter(job, filters.jobType)) return false

  const postedAt = job.postedAt ? Date.parse(job.postedAt) : 0
  if (postedAt) {
    const ageDays = (Date.now() - postedAt) / 86_400_000
    if (ageDays > filters.postedWithinDays) return false
  }

  return true
}

function normalizeLocationFilter(location: string): NormalizedLocationFilter {
  const normalized = location.trim().toLowerCase()
  if (!normalized) {
    return { locationQuery: '', aliases: [] as string[] }
  }

  const usAliases = [
    'united states',
    'united states of america',
    'usa',
    'u.s.',
    'us',
    'america',
  ]

  if (usAliases.includes(normalized)) {
    return {
      locationQuery: 'United States',
      region: 'us',
      aliases: [
        'united states',
        'united states of america',
        'usa',
        'u.s.',
        'u.s. only',
        'us only',
        'us-based',
        'us based',
        'remote us',
        'remote - us',
        'remote (us)',
        'within the us',
        'in the us',
      ],
    }
  }

  if (normalized === 'remote') {
    return {
      locationQuery: 'Remote',
      aliases: ['remote', 'worldwide', 'global', 'anywhere'],
    }
  }

  return {
    locationQuery: location.trim(),
    aliases: [normalized],
  }
}

function matchesLocationFilter(job: Job, normalizedLocation: NormalizedLocationFilter) {
  if (!normalizedLocation.locationQuery || normalizedLocation.locationQuery.toLowerCase() === 'remote') return false

  const locationHaystack = `${job.location} ${job.title} ${job.description}`.toLowerCase()
  if (normalizedLocation.aliases.some((alias) => locationHaystack.includes(alias))) return true

  if (normalizedLocation.region === 'us') {
    const listedLocation = job.location.toLowerCase()
    if (US_STATE_NAMES.some((state) => listedLocation.includes(state)) || US_STATE_CODE_PATTERN.test(job.location)) {
      return true
    }

    return job.source === 'The Muse' && listedLocation.includes('flexible / remote')
  }

  return false
}

function matchesSeniorityFilter(job: Job, seniority: string) {
  const normalized = seniority.trim().toLowerCase()
  if (!normalized || normalized === 'any level') return true

  const aliases: Record<string, string[]> = {
    entry: ['entry', 'junior', 'new grad', 'new graduate', 'graduate', 'early career', 'associate'],
    'mid-level': ['mid-level', 'mid level', 'intermediate', 'experienced', 'associate'],
    senior: ['senior', 'sr.', 'sr ', 'staff', 'principal'],
    lead: ['lead', 'manager', 'head of', 'principal'],
    executive: ['executive', 'director', 'vp', 'vice president', 'chief', 'cxo'],
  }
  const terms = aliases[normalized] || [normalized]
  const haystack = normalizeSearchText(`${job.title} ${job.description} ${job.tags.join(' ')}`)
  return terms.some((term) => haystack.includes(normalizeSearchText(term)))
}

function matchesJobTypeFilter(job: Job, jobType: string) {
  const normalized = jobType.trim().toLowerCase()
  if (!normalized || normalized === 'all types') return true

  const aliases: Record<string, string[]> = {
    'full-time': ['full-time', 'full time', 'full_time', 'permanent', 'regular'],
    contract: ['contract', 'contractor', 'fixed term', 'fixed-term'],
    'part-time': ['part-time', 'part time', 'part_time'],
    internship: ['internship', 'intern', 'co-op', 'coop'],
    freelance: ['freelance', 'freelancer'],
    temporary: ['temporary', 'temp', 'seasonal'],
    volunteer: ['volunteer', 'volunteering'],
  }
  const terms = aliases[normalized] || [normalized]
  const haystack = normalizeSearchText(`${job.title} ${job.description} ${job.tags.join(' ')}`)
  return terms.some((term) => haystack.includes(normalizeSearchText(term)))
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[_/-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isEnglishJob(job: Job) {
  const text = `${job.title} ${job.description} ${job.tags.join(' ')}`.replace(/\s+/g, ' ').trim()
  if (!text) return false

  const sample = text.slice(0, 1200)
  const normalizedSample = sample.toLowerCase()
  const nonEnglishSignals =
    normalizedSample.match(
      /\b(ausbildung|fachinformatiker|systemintegration|bewerbung|bewerben|aufgaben|kenntnisse|abgeschlossene|deutsch|german|berlin|munich|hamburg|koln|frankfurt|und|oder|nicht|deine|fur|eine|einen|unser|unsere|vous|nous|avec|pour|dans|les|des|para|con|por)\b/g,
    )?.length || 0
  if (nonEnglishSignals >= 2) return false

  const letters = sample.match(/[A-Za-z]/g)?.length || 0
  const nonAscii = countNonAscii(sample)
  const commonEnglishWords =
    normalizedSample.match(/\b(the|and|for|with|you|your|our|team|role|work|experience|skills|will|are|to|of|in)\b/g)
      ?.length || 0
  const foreignMarkers =
    normalizedSample.match(
      /\b(und|oder|nicht|deine|aufgaben|bewerbung|fur|mit|eine|einen|des|der|die|das|unser|unsere|vous|nous|avec|pour|dans|les|des|el|la|los|para|con|por)\b/g,
    )?.length || 0

  return letters > 80 && nonAscii / Math.max(sample.length, 1) < 0.04 && commonEnglishWords >= 5 && foreignMarkers <= 1
}

function countNonAscii(value: string) {
  let count = 0
  for (const char of value) {
    if (char.charCodeAt(0) > 127) count += 1
  }
  return count
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
