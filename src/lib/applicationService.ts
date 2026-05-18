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
import { mockJobs } from '../data/mockJobs'
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
  if (functions) {
    try {
      const search = httpsCallable<JobFilters, SearchResponse>(functions, 'searchJobs')
      const response = await search(filters)
      return response.data
    } catch (error) {
      console.warn('Falling back to local job search', error)
    }
  }

  return searchLocalJobs(filters)
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

function searchLocalJobs(filters: JobFilters): SearchResponse {
  const normalizedQuery = filters.query.trim().toLowerCase()
  const normalizedLocation = filters.location.trim().toLowerCase()

  const jobs = mockJobs.filter((job) => {
    const haystack = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')}`
      .toLowerCase()
      .trim()
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery)
    const matchesLocation =
      !normalizedLocation ||
      normalizedLocation === 'remote' ||
      job.location.toLowerCase().includes(normalizedLocation)
    const matchesMode = filters.workMode === 'any' || job.workMode === filters.workMode
    return matchesQuery && matchesLocation && matchesMode
  })

  return { jobs, providers: ['Local demo feed'] }
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
