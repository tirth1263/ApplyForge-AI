export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'any'

export type ApplicationStatus =
  | 'Saved'
  | 'Tailored'
  | 'Applied'
  | 'Interview'
  | 'Offer'
  | 'Rejected'

export type UserProfile = {
  fullName: string
  headline: string
  targetRoles: string
  preferredLocations: string
  portfolioUrl: string
  masterResume: string
  resumeFileName?: string
  resumeFileUrl?: string
  updatedAt?: string
}

export type JobFilters = {
  query: string
  location: string
  workMode: WorkMode
  seniority: string
  jobType: string
  source: string
  postedWithinDays: number
  minSalary: number
}

export type Job = {
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

export type ApplicationForm = {
  role: string
  company: string
  resume: string
  jobDescription: string
  tone: string
}

export type GeneratedAssets = {
  tailoredResume: string
  coverLetter: string
  matchNotes: string[]
  keywords: string[]
}

export type SavedApplication = {
  id: string
  role: string
  company: string
  createdAt: string
  updatedAt?: string
  status: ApplicationStatus
  jobId?: string
  job?: Job
  assets: GeneratedAssets
  notes?: string
}

export type SavedJob = Job & {
  savedAt: string
  status: ApplicationStatus
  notes?: string
}

export type ResumeUpload = {
  fileName: string
  url: string
}

export type WorkspaceSnapshot = {
  profile: UserProfile | null
  savedJobs: SavedJob[]
  applications: SavedApplication[]
}
