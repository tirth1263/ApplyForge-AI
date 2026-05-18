export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'any'

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
  jobId?: string
  assets: GeneratedAssets
}
