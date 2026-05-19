import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import {
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardList,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Filter,
  Globe2,
  LayoutDashboard,
  Link as LinkIcon,
  Loader2,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  PenLine,
  Save,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react'
import './App.css'
import {
  auth,
  firebaseConfigIsComplete,
  getAuthErrorMessage,
  signInWithGoogle,
  signOutOfGoogle,
} from './lib/firebase'
import {
  deleteSavedJob,
  emptyProfile,
  generateApplicationAssets,
  saveApplication,
  saveJob,
  saveUserProfile,
  searchJobs,
  subscribeToApplications,
  subscribeToSavedJobs,
  subscribeToUserProfile,
  updateApplicationStatus,
  updateSavedJobStatus,
  uploadResumeFile,
} from './lib/applicationService'
import type {
  ApplicationForm,
  ApplicationStatus,
  GeneratedAssets,
  Job,
  JobFilters,
  SavedApplication,
  SavedJob,
  UserProfile,
} from './types'

type AppRoute = 'dashboard' | 'jobs' | 'tailor' | 'saved-jobs' | 'resume-vault' | 'tracker' | 'settings'
type ThemePreference = 'default' | 'light' | 'dark'

const statuses: ApplicationStatus[] = ['Saved', 'Tailored', 'Applied', 'Interview', 'Offer', 'Rejected']

const initialFilters: JobFilters = {
  query: '',
  location: 'United States',
  workMode: 'any',
  seniority: 'Any level',
  jobType: 'All types',
  source: 'All sources',
  postedWithinDays: 90,
  minSalary: 0,
}

const initialForm: ApplicationForm = {
  role: '',
  company: '',
  resume: '',
  jobDescription: '',
  tone: 'Confident and concise',
}

const routeConfig: Array<{
  route: AppRoute
  path: string
  label: string
  icon: typeof Monitor
}> = [
  { route: 'dashboard', path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { route: 'jobs', path: '/jobs', label: 'US Jobs', icon: Search },
  { route: 'tailor', path: '/tailor-resume', label: 'Tailor Resume', icon: PenLine },
  { route: 'saved-jobs', path: '/saved-jobs', label: 'Saved Jobs', icon: Save },
  { route: 'resume-vault', path: '/resume-vault', label: 'Resume Vault', icon: FileText },
  { route: 'tracker', path: '/tracker', label: 'Tracker', icon: ClipboardList },
  { route: 'settings', path: '/settings', label: 'Cloud Setup', icon: ShieldCheck },
]

const themeOptions: Array<{
  value: ThemePreference
  label: string
  icon: typeof Monitor
}> = [
  { value: 'default', label: 'Default', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

function App() {
  const [route, setRoute] = useState<AppRoute>(getRouteFromLocation)
  const [user, setUser] = useState<User | null>(null)
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [profile, setProfile] = useState<UserProfile>(emptyProfile)
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([])
  const [applications, setApplications] = useState<SavedApplication[]>([])
  const [filters, setFilters] = useState<JobFilters>(initialFilters)
  const [savedSearch, setSavedSearch] = useState('')
  const [savedStatusFilter, setSavedStatusFilter] = useState<ApplicationStatus | 'All'>('All')
  const [jobs, setJobs] = useState<Job[]>([])
  const [providers, setProviders] = useState<string[]>([])
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [form, setForm] = useState<ApplicationForm>(initialForm)
  const [generated, setGenerated] = useState<GeneratedAssets | null>(null)
  const [activeOutput, setActiveOutput] = useState<'resume' | 'letter' | 'notes'>('resume')
  const [searching, setSearching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [status, setStatus] = useState('Workspace ready')
  const [authIssue, setAuthIssue] = useState('')

  useEffect(() => {
    document.documentElement.dataset.theme = themePreference
    localStorage.setItem('applyforge.theme', themePreference)
  }, [themePreference])

  useEffect(() => {
    const onPopState = () => setRoute(getRouteFromLocation())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let active = true

    async function loadInitialJobs() {
      setSearching(true)
      setStatus('Loading United States roles')
      try {
        const response = await searchJobs(initialFilters)
        if (!active) return
        setJobs(response.jobs)
        setProviders(response.providers)
        setSelectedJob(response.jobs[0] ?? null)
        setStatus(`${response.jobs.length} English US roles loaded`)
      } catch (error) {
        if (!active) return
        setStatus(error instanceof Error ? error.message : 'Job search failed')
      } finally {
        if (active) setSearching(false)
      }
    }

    void loadInitialJobs()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthLoading(false)
      if (nextUser) setAuthIssue('')
      setStatus(nextUser ? 'Google sign-in active' : 'Signed out')
    })
  }, [])

  useEffect(() => {
    const unsubProfile = subscribeToUserProfile(user?.uid, (nextProfile) => {
      const fallback = {
        ...emptyProfile,
        fullName: user?.displayName || '',
        portfolioUrl: '',
      }
      const resolved = nextProfile || fallback
      setProfile(resolved)
      if (resolved.masterResume) {
        setForm((current) => ({ ...current, resume: resolved.masterResume }))
      }
    })
    const unsubJobs = subscribeToSavedJobs(user?.uid, setSavedJobs)
    const unsubApplications = subscribeToApplications(user?.uid, setApplications)

    return () => {
      unsubProfile()
      unsubJobs()
      unsubApplications()
    }
  }, [user?.uid, user?.displayName])

  const statusCounts = useMemo(
    () =>
      statuses.reduce<Record<ApplicationStatus, number>>(
        (acc, item) => {
          acc[item] =
            applications.filter((application) => application.status === item).length +
            savedJobs.filter((job) => job.status === item).length
          return acc
        },
        {
          Saved: 0,
          Tailored: 0,
          Applied: 0,
          Interview: 0,
          Offer: 0,
          Rejected: 0,
        },
      ),
    [applications, savedJobs],
  )

  const metrics = useMemo(
    () => [
      { label: 'US roles', value: jobs.length, icon: BriefcaseBusiness },
      { label: 'Major boards', value: 3, icon: SlidersHorizontal },
      { label: 'Saved jobs', value: savedJobs.length, icon: Save },
      { label: 'Applications', value: applications.length, icon: ClipboardList },
    ],
    [applications.length, jobs.length, savedJobs.length],
  )

  const setupCompletion = useMemo(() => {
    const checks = [
      firebaseConfigIsComplete,
      Boolean(user),
      Boolean(profile.masterResume || profile.resumeFileUrl),
      applications.length > 0,
      providers.length > 0,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [applications.length, profile.masterResume, profile.resumeFileUrl, providers, user])

  const companySignals = useMemo(() => buildCompanySignals(jobs), [jobs])
  const externalBoards = useMemo(() => buildExternalJobBoards(filters), [filters])
  const filteredSavedJobs = useMemo(
    () =>
      savedJobs.filter((job) => {
        const haystack = `${job.title} ${job.company} ${job.location}`.toLowerCase()
        const matchesText = !savedSearch || haystack.includes(savedSearch.toLowerCase())
        const matchesStatus = savedStatusFilter === 'All' || job.status === savedStatusFilter
        return matchesText && matchesStatus
      }),
    [savedJobs, savedSearch, savedStatusFilter],
  )

  const pageMeta = getPageMeta(route)

  function navigate(nextRoute: AppRoute) {
    const path = pathForRoute(nextRoute)
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
    setRoute(nextRoute)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleRouteClick(event: MouseEvent<HTMLAnchorElement>, nextRoute: AppRoute) {
    event.preventDefault()
    navigate(nextRoute)
  }

  async function handleSignIn() {
    try {
      setStatus('Opening Google sign-in')
      await signInWithGoogle()
      setAuthIssue('')
    } catch (error) {
      const message = getAuthErrorMessage(error)
      setAuthIssue(message)
      setStatus('Google sign-in needs Firebase Auth setup')
    }
  }

  async function handleSignOut() {
    await signOutOfGoogle()
  }

  async function handleSearch() {
    setSearching(true)
    setStatus('Searching United States roles')
    const usFilters = { ...filters, location: 'United States' }
    setFilters(usFilters)
    try {
      const response = await searchJobs(usFilters)
      setJobs(response.jobs)
      setProviders(response.providers)
      setSelectedJob(response.jobs[0] ?? null)
      setStatus(`${response.jobs.length} English US roles found`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Job search failed')
    } finally {
      setSearching(false)
    }
  }

  async function handleProfileSave(nextProfile = profile) {
    setProfileSaving(true)
    setStatus('Saving profile')
    try {
      await saveUserProfile(user?.uid, nextProfile)
      setForm((current) => ({ ...current, resume: nextProfile.masterResume }))
      setStatus(user ? 'Profile saved to Firebase' : 'Profile saved locally')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Profile save failed')
    } finally {
      setProfileSaving(false)
    }
  }

  async function handleResumeUpload(file: File | undefined) {
    if (!file) return
    if (!user) {
      setStatus('Sign in with Google before uploading files')
      return
    }

    setUploadProgress(0)
    setStatus('Uploading resume')
    try {
      const text = await readResumeText(file)
      const upload = await uploadResumeFile(user.uid, file, setUploadProgress)
      const nextProfile = {
        ...profile,
        masterResume: text || profile.masterResume,
        resumeFileName: upload.fileName,
        resumeFileUrl: upload.url,
      }
      setProfile(nextProfile)
      await handleProfileSave(nextProfile)
      setStatus('Resume uploaded to Firebase Storage')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Resume upload failed')
    } finally {
      setUploadProgress(null)
    }
  }

  async function handleSaveJob(job: Job) {
    setSaving(true)
    try {
      await saveJob(user?.uid, job)
      setSavedJobs((current) => {
        const savedJob: SavedJob = {
          ...job,
          savedAt: new Date().toISOString(),
          status: 'Saved',
        }
        return [savedJob, ...current.filter((saved) => saved.id !== job.id)]
      })
      setStatus(`Saved ${job.title}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save job')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setStatus('Generating resume and cover letter')
    try {
      const assets = await generateApplicationAssets(form)
      setGenerated(assets)
      setActiveOutput('resume')
      await saveApplication(user?.uid, {
        role: form.role,
        company: form.company,
        jobId: selectedJob?.id,
        job: selectedJob || undefined,
        assets,
        status: 'Tailored',
      })
      if (selectedJob) {
        await saveJob(user?.uid, selectedJob)
      }
      setStatus(user ? 'Application package saved' : 'Application package saved locally')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function loadJobIntoStudio(job: Job) {
    setSelectedJob(job)
    setForm((current) => ({
      ...current,
      role: job.title,
      company: job.company,
      resume: profile.masterResume || current.resume,
      jobDescription: job.description,
    }))
    setStatus(`Loaded ${job.company} into Tailor Resume`)
    navigate('tailor')
  }

  function loadApplication(application: SavedApplication) {
    setGenerated(application.assets)
    setActiveOutput('resume')
    setForm((current) => ({
      ...current,
      role: application.role,
      company: application.company,
      jobDescription: application.job?.description || current.jobDescription,
    }))
    setStatus(`Opened ${application.company} package`)
    navigate('tailor')
  }

  async function handleSavedJobStatus(jobId: string, nextStatus: ApplicationStatus) {
    await updateSavedJobStatus(user?.uid, jobId, nextStatus)
    setSavedJobs((current) => current.map((job) => (job.id === jobId ? { ...job, status: nextStatus } : job)))
  }

  async function handleDeleteSavedJob(jobId: string) {
    await deleteSavedJob(user?.uid, jobId)
    setSavedJobs((current) => current.filter((job) => job.id !== jobId))
  }

  async function handleApplicationStatus(applicationId: string, nextStatus: ApplicationStatus) {
    await updateApplicationStatus(user?.uid, applicationId, nextStatus)
    setApplications((current) =>
      current.map((application) =>
        application.id === applicationId ? { ...application, status: nextStatus } : application,
      ),
    )
  }

  function copyCurrentOutput() {
    const output = getCurrentOutput(generated, activeOutput)
    if (!output) return
    void navigator.clipboard.writeText(output)
    setStatus('Copied output')
  }

  function downloadCurrentOutput() {
    const output = getCurrentOutput(generated, activeOutput)
    if (!output) return
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugify(form.company || 'company')}-${slugify(form.role || 'role')}-${activeOutput}.txt`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('Downloaded output')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <button className="brand-lockup brand-button" type="button" onClick={() => navigate('dashboard')}>
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>ApplyForge AI</strong>
            <span>US job application OS</span>
          </div>
        </button>

        <nav className="nav-list">
          {routeConfig.map((item) => {
            const Icon = item.icon
            return (
              <a
                key={item.route}
                href={item.path}
                className={route === item.route ? 'active' : ''}
                onClick={(event) => handleRouteClick(event, item.route)}
              >
                <Icon size={18} />
                {item.label}
              </a>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="cloud-card">
            <div>
              <Cloud size={17} />
              <span>{firebaseConfigIsComplete ? 'Firebase connected' : 'Demo mode'}</span>
            </div>
            <strong>{setupCompletion}% ready</strong>
            <progress value={setupCompletion} max="100" aria-label="Workspace completion" />
          </div>
          <p>{user ? user.email : 'Google sign-in required for cloud sync'}</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-intro">
            <div className="theme-switcher dashboard-theme" aria-label="Theme preference">
              {themeOptions.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    className={themePreference === option.value ? 'active' : ''}
                    type="button"
                    onClick={() => setThemePreference(option.value)}
                    title={`${option.label} theme`}
                  >
                    <Icon size={15} />
                    {option.label}
                  </button>
                )
              })}
            </div>
            <span className="eyebrow">{pageMeta.eyebrow}</span>
            <h1>{pageMeta.title}</h1>
          </div>
          <div className="account-area">
            <span className="status-pill">{status}</span>
            {user ? (
              <button className="button secondary" type="button" onClick={handleSignOut}>
                <LogOut size={17} />
                Sign out
              </button>
            ) : (
              <button
                className="button primary"
                type="button"
                onClick={handleSignIn}
                disabled={!firebaseConfigIsComplete || authLoading}
              >
                <UserRound size={17} />
                {authLoading ? 'Checking' : 'Google sign in'}
              </button>
            )}
          </div>
        </header>

        {authIssue && (
          <section className="auth-alert" aria-live="polite">
            <ShieldCheck size={18} />
            <div>
              <strong>Google sign-in setup needed</strong>
              <p>{authIssue}</p>
              <a
                href="https://console.firebase.google.com/project/applyforge-ai/authentication/providers"
                target="_blank"
                rel="noreferrer"
              >
                Open Firebase Authentication
              </a>
            </div>
          </section>
        )}

        {route === 'dashboard' && (
          <DashboardPage
            metrics={metrics}
            providers={providers}
            externalBoards={externalBoards}
            companySignals={companySignals}
            onNavigate={navigate}
            onCompanySearch={(company) => {
              setFilters((current) => ({ ...current, query: company.name, location: 'United States' }))
              navigate('jobs')
            }}
          />
        )}

        {route === 'jobs' && (
          <JobsPage
            filters={filters}
            jobs={jobs}
            providers={providers}
            searching={searching}
            saving={saving}
            externalBoards={externalBoards}
            onFiltersChange={setFilters}
            onSearch={handleSearch}
            onTailor={loadJobIntoStudio}
            onSave={handleSaveJob}
          />
        )}

        {route === 'tailor' && (
          <TailorPage
            form={form}
            profile={profile}
            generated={generated}
            activeOutput={activeOutput}
            generating={generating}
            selectedJob={selectedJob}
            onFormChange={setForm}
            onProfileChange={setProfile}
            onGenerate={handleGenerate}
            onOutputChange={setActiveOutput}
            onCopy={copyCurrentOutput}
            onDownload={downloadCurrentOutput}
          />
        )}

        {route === 'saved-jobs' && (
          <SavedJobsPage
            jobs={filteredSavedJobs}
            savedSearch={savedSearch}
            savedStatusFilter={savedStatusFilter}
            onSearchChange={setSavedSearch}
            onStatusFilterChange={setSavedStatusFilter}
            onStatusChange={handleSavedJobStatus}
            onDelete={handleDeleteSavedJob}
            onTailor={loadJobIntoStudio}
            onFindMore={() => navigate('jobs')}
          />
        )}

        {route === 'resume-vault' && (
          <ResumeVaultPage
            profile={profile}
            profileSaving={profileSaving}
            uploadProgress={uploadProgress}
            onProfileChange={setProfile}
            onProfileSave={handleProfileSave}
            onResumeUpload={handleResumeUpload}
          />
        )}

        {route === 'tracker' && (
          <TrackerPage
            statusCounts={statusCounts}
            savedJobs={savedJobs}
            applications={applications}
            onSavedStatusChange={handleSavedJobStatus}
            onDeleteSavedJob={handleDeleteSavedJob}
            onApplicationStatusChange={handleApplicationStatus}
            onOpenApplication={loadApplication}
          />
        )}

        {route === 'settings' && (
          <SettingsPage
            firebaseReady={firebaseConfigIsComplete}
            user={user}
            profile={profile}
            applications={applications}
            providers={providers}
          />
        )}
      </main>
    </div>
  )
}

function DashboardPage({
  metrics,
  providers,
  externalBoards,
  companySignals,
  onNavigate,
  onCompanySearch,
}: {
  metrics: Array<{ label: string; value: number; icon: typeof Monitor }>
  providers: string[]
  externalBoards: ReturnType<typeof buildExternalJobBoards>
  companySignals: ReturnType<typeof buildCompanySignals>
  onNavigate: (route: AppRoute) => void
  onCompanySearch: (company: ReturnType<typeof buildCompanySignals>[number]) => void
}) {
  return (
    <div className="page-stack">
      <section className="metric-grid" aria-label="Workspace metrics">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <div className="metric" key={metric.label}>
              <Icon size={19} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          )
        })}
      </section>

      <section className="quick-grid" aria-label="Primary workflows">
        <WorkflowCard
          icon={<Search size={22} />}
          title="Find US roles"
          detail="Search authentic English-language roles limited to the United States."
          action="Open jobs"
          onClick={() => onNavigate('jobs')}
        />
        <WorkflowCard
          icon={<PenLine size={22} />}
          title="Tailor resume"
          detail="Generate a tailored resume, cover letter, match notes, and ATS keywords."
          action="Tailor now"
          onClick={() => onNavigate('tailor')}
        />
        <WorkflowCard
          icon={<Save size={22} />}
          title="Manage saved jobs"
          detail="Review saved roles, update statuses, delete jobs, and continue tailoring."
          action="Manage jobs"
          onClick={() => onNavigate('saved-jobs')}
        />
      </section>

      <section className="workspace-grid">
        <div className="primary-column">
          <section className="tool-panel">
            <PanelTitle
              eyebrow="Trusted search routes"
              title="Major Job Boards"
              icon={<Globe2 size={20} />}
            />
            <p className="quiet-copy">
              These links open the same US role, location, and filter context on major boards. The in-app list only uses
              feeds that can be accessed as real public listings.
            </p>
            <ExternalBoardGrid boards={externalBoards} />
            <div className="provider-line">
              <span>In-app feed: United States only</span>
              {providers.map((provider) => (
                <span key={provider}>Source: {provider}</span>
              ))}
            </div>
          </section>
        </div>

        <aside className="insights-column" aria-label="Hiring company signals">
          <section className="tool-panel compact">
            <PanelTitle eyebrow="Company intelligence" title="Hiring Signals" icon={<Building2 size={20} />} />
            <CompanySignalList companies={companySignals} onSelect={onCompanySearch} />
          </section>
        </aside>
      </section>
    </div>
  )
}

function JobsPage({
  filters,
  jobs,
  providers,
  searching,
  saving,
  externalBoards,
  onFiltersChange,
  onSearch,
  onTailor,
  onSave,
}: {
  filters: JobFilters
  jobs: Job[]
  providers: string[]
  searching: boolean
  saving: boolean
  externalBoards: ReturnType<typeof buildExternalJobBoards>
  onFiltersChange: (filters: JobFilters) => void
  onSearch: () => void
  onTailor: (job: Job) => void
  onSave: (job: Job) => void
}) {
  const setFilter = <Key extends keyof JobFilters>(key: Key, value: JobFilters[Key]) => {
    onFiltersChange({ ...filters, [key]: value, location: 'United States' })
  }

  return (
    <section className="tool-panel" aria-labelledby="jobs-title">
      <PanelTitle
        eyebrow="United States role search"
        title="Jobs and Hiring Companies"
        icon={<Globe2 size={20} />}
        action={
          <button className="button primary" type="button" onClick={onSearch}>
            {searching ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
            Search
          </button>
        }
      />

      <div className="filters">
        <FieldIcon icon={<Search size={16} />}>
          <input
            value={filters.query}
            onChange={(event) => setFilter('query', event.target.value)}
            placeholder="Role, company, or skill"
          />
        </FieldIcon>
        <FieldIcon icon={<MapPin size={16} />}>
          <input value="United States only" readOnly aria-label="Location locked to United States" />
        </FieldIcon>
        <FieldIcon icon={<Globe2 size={16} />}>
          <select
            value={filters.workMode}
            onChange={(event) => setFilter('workMode', event.target.value as JobFilters['workMode'])}
          >
            <option value="any">Any mode</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </select>
        </FieldIcon>
        <FieldIcon icon={<Target size={16} />}>
          <select value={filters.seniority} onChange={(event) => setFilter('seniority', event.target.value)}>
            <option>Any level</option>
            <option>Entry</option>
            <option>Mid-level</option>
            <option>Senior</option>
            <option>Lead</option>
            <option>Executive</option>
          </select>
        </FieldIcon>
        <FieldIcon icon={<Filter size={16} />}>
          <select value={filters.jobType} onChange={(event) => setFilter('jobType', event.target.value)}>
            <option>All types</option>
            <option>Full-time</option>
            <option>Contract</option>
            <option>Part-time</option>
            <option>Internship</option>
            <option>Freelance</option>
            <option>Temporary</option>
            <option>Volunteer</option>
          </select>
        </FieldIcon>
        <FieldIcon icon={<Database size={16} />}>
          <select value={filters.source} onChange={(event) => setFilter('source', event.target.value)}>
            <option>All sources</option>
            <option>The Muse</option>
            <option>Remotive</option>
          </select>
        </FieldIcon>
        <FieldIcon icon={<CalendarClock size={16} />}>
          <select
            value={filters.postedWithinDays}
            onChange={(event) => setFilter('postedWithinDays', Number(event.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </FieldIcon>
      </div>

      <div className="provider-line">
        <span>English-language United States listings only</span>
        {providers.map((provider) => (
          <span key={provider}>Source: {provider}</span>
        ))}
      </div>

      <ExternalBoardGrid boards={externalBoards} />

      <div className="job-list">
        {jobs.length ? (
          jobs.map((job) => (
            <article className="job-item" key={job.id}>
              <div className="job-main">
                <div className="job-title-row">
                  <h3>{job.title}</h3>
                  <span>{job.workMode}</span>
                </div>
                <p className="company-line">
                  <Building2 size={15} />
                  {job.company} - {job.location}
                </p>
                <p>{job.description}</p>
                <div className="tag-row">
                  {job.salary && <span>{job.salary}</span>}
                  {job.tags.slice(0, 5).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="job-actions">
                <button className="button secondary" type="button" onClick={() => onTailor(job)}>
                  <PenLine size={16} />
                  Tailor
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => onSave(job)}
                  disabled={saving}
                  title="Save job"
                >
                  <Save size={17} />
                </button>
                <a className="button secondary" href={job.url} target="_blank" rel="noreferrer" title="Open job">
                  <ExternalLink size={17} />
                  Apply
                </a>
              </div>
            </article>
          ))
        ) : (
          <EmptyState icon={<Search size={24} />} title="No matching US roles" detail="Try a broader role keyword." />
        )}
      </div>
    </section>
  )
}

function TailorPage({
  form,
  profile,
  generated,
  activeOutput,
  generating,
  selectedJob,
  onFormChange,
  onProfileChange,
  onGenerate,
  onOutputChange,
  onCopy,
  onDownload,
}: {
  form: ApplicationForm
  profile: UserProfile
  generated: GeneratedAssets | null
  activeOutput: 'resume' | 'letter' | 'notes'
  generating: boolean
  selectedJob: Job | null
  onFormChange: (form: ApplicationForm | ((current: ApplicationForm) => ApplicationForm)) => void
  onProfileChange: (profile: UserProfile | ((current: UserProfile) => UserProfile)) => void
  onGenerate: () => void
  onOutputChange: (output: 'resume' | 'letter' | 'notes') => void
  onCopy: () => void
  onDownload: () => void
}) {
  return (
    <section className="tool-panel studio-panel" aria-labelledby="studio-title">
      <PanelTitle
        eyebrow="AI application studio"
        title="Tailored Resume and Cover Letter"
        icon={<Sparkles size={20} />}
        action={
          <button className="button primary" type="button" onClick={onGenerate} disabled={generating}>
            {generating ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
            Generate
          </button>
        }
      />

      {selectedJob && (
        <section className="selection-banner">
          <div>
            <span className="eyebrow">Selected role</span>
            <strong>{selectedJob.title}</strong>
            <p>{selectedJob.company} - {selectedJob.location}</p>
          </div>
          <a className="button secondary" href={selectedJob.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Job link
          </a>
        </section>
      )}

      <div className="studio-grid">
        <div className="form-stack">
          <div className="two-fields">
            <label>
              Role
              <input
                value={form.role}
                onChange={(event) => onFormChange((current) => ({ ...current, role: event.target.value }))}
              />
            </label>
            <label>
              Company
              <input
                value={form.company}
                onChange={(event) => onFormChange((current) => ({ ...current, company: event.target.value }))}
              />
            </label>
          </div>
          <label>
            Writing style
            <select
              value={form.tone}
              onChange={(event) => onFormChange((current) => ({ ...current, tone: event.target.value }))}
            >
              <option>Confident and concise</option>
              <option>Warm and story-driven</option>
              <option>Executive and direct</option>
              <option>Technical and evidence-led</option>
            </select>
          </label>
          <label>
            Master resume
            <textarea
              value={form.resume}
              onChange={(event) => {
                const resume = event.target.value
                onFormChange((current) => ({ ...current, resume }))
                onProfileChange((current) => ({ ...current, masterResume: resume }))
              }}
              placeholder="Paste your master resume here."
            />
          </label>
          <label>
            Job description
            <textarea
              value={form.jobDescription}
              onChange={(event) => onFormChange((current) => ({ ...current, jobDescription: event.target.value }))}
              placeholder="Click Tailor from a job card or paste the job description here."
            />
          </label>
          {!profile.masterResume && <p className="quiet-line">Tip: save your resume in Resume Vault for faster tailoring.</p>}
        </div>

        <div className="output-surface">
          <div className="tabs" role="tablist" aria-label="Generated output">
            <button className={activeOutput === 'resume' ? 'active' : ''} type="button" onClick={() => onOutputChange('resume')}>
              <FileText size={16} />
              Resume
            </button>
            <button className={activeOutput === 'letter' ? 'active' : ''} type="button" onClick={() => onOutputChange('letter')}>
              <PenLine size={16} />
              Letter
            </button>
            <button className={activeOutput === 'notes' ? 'active' : ''} type="button" onClick={() => onOutputChange('notes')}>
              <ClipboardList size={16} />
              Notes
            </button>
          </div>

          <pre>{getCurrentOutput(generated, activeOutput) || 'Generated documents will appear here.'}</pre>

          <div className="output-actions">
            <button className="button secondary" type="button" onClick={onCopy} disabled={!generated}>
              <Copy size={16} />
              Copy
            </button>
            <button className="button secondary" type="button" onClick={onDownload} disabled={!generated}>
              <Download size={16} />
              Download
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function SavedJobsPage({
  jobs,
  savedSearch,
  savedStatusFilter,
  onSearchChange,
  onStatusFilterChange,
  onStatusChange,
  onDelete,
  onTailor,
  onFindMore,
}: {
  jobs: SavedJob[]
  savedSearch: string
  savedStatusFilter: ApplicationStatus | 'All'
  onSearchChange: (value: string) => void
  onStatusFilterChange: (value: ApplicationStatus | 'All') => void
  onStatusChange: (jobId: string, status: ApplicationStatus) => void
  onDelete: (jobId: string) => void
  onTailor: (job: Job) => void
  onFindMore: () => void
}) {
  return (
    <section className="tool-panel">
      <PanelTitle
        eyebrow="Saved role manager"
        title="Saved Jobs"
        icon={<Save size={20} />}
        action={
          <button className="button primary" type="button" onClick={onFindMore}>
            <Search size={17} />
            Add more jobs
          </button>
        }
      />

      <div className="saved-toolbar">
        <FieldIcon icon={<Search size={16} />}>
          <input value={savedSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Filter saved jobs" />
        </FieldIcon>
        <FieldIcon icon={<Filter size={16} />}>
          <select
            value={savedStatusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as ApplicationStatus | 'All')}
          >
            <option>All</option>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </FieldIcon>
      </div>

      <div className="job-list">
        {jobs.length ? (
          jobs.map((job) => (
            <article className="job-item" key={job.id}>
              <div className="job-main">
                <div className="job-title-row">
                  <h3>{job.title}</h3>
                  <span>{job.status}</span>
                </div>
                <p className="company-line">
                  <Building2 size={15} />
                  {job.company} - {job.location}
                </p>
                <div className="tag-row">
                  {job.tags.slice(0, 5).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="job-actions">
                <select value={job.status} onChange={(event) => onStatusChange(job.id, event.target.value as ApplicationStatus)}>
                  {statuses.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <button className="button secondary" type="button" onClick={() => onTailor(job)}>
                  <PenLine size={16} />
                  Tailor
                </button>
                <button className="icon-button" type="button" title="Delete saved job" onClick={() => onDelete(job.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))
        ) : (
          <EmptyState icon={<Save size={24} />} title="No saved jobs found" detail="Add roles from the US Jobs page." />
        )}
      </div>
    </section>
  )
}

function ResumeVaultPage({
  profile,
  profileSaving,
  uploadProgress,
  onProfileChange,
  onProfileSave,
  onResumeUpload,
}: {
  profile: UserProfile
  profileSaving: boolean
  uploadProgress: number | null
  onProfileChange: (profile: UserProfile | ((current: UserProfile) => UserProfile)) => void
  onProfileSave: () => void
  onResumeUpload: (file: File | undefined) => void
}) {
  return (
    <section className="tool-panel resume-page">
      <PanelTitle
        eyebrow="Candidate profile"
        title="Resume Vault"
        icon={<FileUp size={20} />}
        action={
          <button className="button primary" type="button" onClick={onProfileSave} disabled={profileSaving}>
            {profileSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            Save profile
          </button>
        }
      />

      <div className="profile-form wide">
        <label>
          Full name
          <input value={profile.fullName} onChange={(event) => onProfileChange((current) => ({ ...current, fullName: event.target.value }))} />
        </label>
        <label>
          Headline
          <input
            value={profile.headline}
            onChange={(event) => onProfileChange((current) => ({ ...current, headline: event.target.value }))}
            placeholder="Product, engineering, operations..."
          />
        </label>
        <label>
          Target roles
          <input value={profile.targetRoles} onChange={(event) => onProfileChange((current) => ({ ...current, targetRoles: event.target.value }))} />
        </label>
        <label>
          Preferred locations
          <input
            value={profile.preferredLocations}
            onChange={(event) => onProfileChange((current) => ({ ...current, preferredLocations: event.target.value }))}
            placeholder="United States, New York, Remote US..."
          />
        </label>
        <label>
          Portfolio URL
          <input value={profile.portfolioUrl} onChange={(event) => onProfileChange((current) => ({ ...current, portfolioUrl: event.target.value }))} />
        </label>
      </div>

      <label>
        Master resume text
        <textarea
          value={profile.masterResume}
          onChange={(event) => onProfileChange((current) => ({ ...current, masterResume: event.target.value }))}
          placeholder="Paste your full master resume here."
        />
      </label>

      <div className="upload-row">
        <label className="file-control">
          <FileUp size={17} />
          Resume file
          <input type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={(event) => onResumeUpload(event.target.files?.[0])} />
        </label>
        {profile.resumeFileUrl && (
          <a className="icon-button" href={profile.resumeFileUrl} target="_blank" rel="noreferrer" title="Open uploaded resume">
            <LinkIcon size={17} />
          </a>
        )}
      </div>
      {uploadProgress !== null && <progress value={uploadProgress} max="100" aria-label="Upload progress" />}
      {profile.resumeFileName && <p className="quiet-line">{profile.resumeFileName}</p>}
    </section>
  )
}

function TrackerPage({
  statusCounts,
  savedJobs,
  applications,
  onSavedStatusChange,
  onDeleteSavedJob,
  onApplicationStatusChange,
  onOpenApplication,
}: {
  statusCounts: Record<ApplicationStatus, number>
  savedJobs: SavedJob[]
  applications: SavedApplication[]
  onSavedStatusChange: (jobId: string, status: ApplicationStatus) => void
  onDeleteSavedJob: (jobId: string) => void
  onApplicationStatusChange: (applicationId: string, status: ApplicationStatus) => void
  onOpenApplication: (application: SavedApplication) => void
}) {
  return (
    <section className="tool-panel">
      <PanelTitle eyebrow="Application pipeline" title="Tracker" icon={<ClipboardList size={20} />} />

      <div className="status-grid">
        {statuses.map((item) => (
          <div key={item}>
            <span>{item}</span>
            <strong>{statusCounts[item]}</strong>
          </div>
        ))}
      </div>

      <div className="tracker-grid">
        <div>
          <h3>Saved jobs</h3>
          <div className="compact-list">
            {savedJobs.length ? (
              savedJobs.map((job) => (
                <article key={job.id} className="compact-item">
                  <div>
                    <strong>{job.title}</strong>
                    <span>{job.company}</span>
                  </div>
                  <select value={job.status} onChange={(event) => onSavedStatusChange(job.id, event.target.value as ApplicationStatus)}>
                    {statuses.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <button className="icon-button" type="button" title="Remove saved job" onClick={() => onDeleteSavedJob(job.id)}>
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <EmptyState icon={<Save size={22} />} title="No saved jobs" detail="Save roles from search." />
            )}
          </div>
        </div>

        <div>
          <h3>Application packages</h3>
          <div className="compact-list">
            {applications.length ? (
              applications.map((application) => (
                <article key={application.id} className="compact-item application-item">
                  <button type="button" onClick={() => onOpenApplication(application)}>
                    <strong>{application.role}</strong>
                    <span>
                      {application.company} - {formatDate(application.createdAt)}
                    </span>
                  </button>
                  <select
                    value={application.status}
                    onChange={(event) => onApplicationStatusChange(application.id, event.target.value as ApplicationStatus)}
                  >
                    {statuses.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </article>
              ))
            ) : (
              <EmptyState icon={<Sparkles size={22} />} title="No packages yet" detail="Generate one from Tailor Resume." />
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function SettingsPage({
  firebaseReady,
  user,
  profile,
  applications,
  providers,
}: {
  firebaseReady: boolean
  user: User | null
  profile: UserProfile
  applications: SavedApplication[]
  providers: string[]
}) {
  return (
    <section className="tool-panel compact">
      <PanelTitle eyebrow="Firebase services" title="Cloud Readiness" icon={<ShieldCheck size={20} />} />
      <ul className="setup-list">
        <ReadinessItem done={firebaseReady} icon={<Database size={14} />} label="Web config loaded" />
        <ReadinessItem done={Boolean(user)} icon={<UserRound size={14} />} label="Google Auth session" />
        <ReadinessItem
          done={Boolean(profile.masterResume || profile.resumeFileUrl)}
          icon={<FileText size={14} />}
          label="Resume stored"
        />
        <ReadinessItem done={applications.length > 0} icon={<Sparkles size={14} />} label="AI package saved" />
        <ReadinessItem done={providers.length > 0} icon={<Globe2 size={14} />} label="Live US job provider" />
      </ul>
    </section>
  )
}

function WorkflowCard({
  icon,
  title,
  detail,
  action,
  onClick,
}: {
  icon: ReactNode
  title: string
  detail: string
  action: string
  onClick: () => void
}) {
  return (
    <button className="workflow-card" type="button" onClick={onClick}>
      <span className="panel-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <span className="board-action">
        {action}
        <ChevronRight size={14} />
      </span>
    </button>
  )
}

function ExternalBoardGrid({ boards }: { boards: ReturnType<typeof buildExternalJobBoards> }) {
  return (
    <div className="board-grid" aria-label="Major job board routes">
      {boards.map((board) => (
        <a key={board.name} className="board-card" href={board.url} target="_blank" rel="noreferrer">
          <div>
            <strong>{board.name}</strong>
            <span>{board.signal}</span>
          </div>
          <p>{board.detail}</p>
          <span className="board-action">
            Open search
            <ExternalLink size={14} />
          </span>
        </a>
      ))}
    </div>
  )
}

function CompanySignalList({
  companies,
  onSelect,
}: {
  companies: ReturnType<typeof buildCompanySignals>
  onSelect: (company: ReturnType<typeof buildCompanySignals>[number]) => void
}) {
  return (
    <div className="company-list">
      {companies.length ? (
        companies.map((company) => (
          <button key={company.name} type="button" onClick={() => onSelect(company)}>
            <div>
              <strong>{company.name}</strong>
              <span>{company.locations.slice(0, 2).join(' - ')}</span>
            </div>
            <span>{company.count}</span>
            <ChevronRight size={16} />
          </button>
        ))
      ) : (
        <EmptyState icon={<Building2 size={22} />} title="No company signals yet" detail="Run a US job search." />
      )}
    </div>
  )
}

function PanelTitle({
  eyebrow,
  title,
  icon,
  action,
}: {
  eyebrow: string
  title: string
  icon: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="panel-heading-actions">
        {action}
        <span className="panel-icon">{icon}</span>
      </div>
    </div>
  )
}

function FieldIcon({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <label className="field-icon">
      {icon}
      {children}
    </label>
  )
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode
  title: string
  detail: string
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function ReadinessItem({
  done,
  icon,
  label,
}: {
  done: boolean
  icon: ReactNode
  label: string
}) {
  return (
    <li className={done ? 'done' : ''}>
      <span>{done ? <Check size={14} /> : icon}</span>
      {label}
    </li>
  )
}

function getCurrentOutput(generated: GeneratedAssets | null, activeOutput: 'resume' | 'letter' | 'notes') {
  if (!generated) return ''

  if (activeOutput === 'resume') return generated.tailoredResume
  if (activeOutput === 'letter') return generated.coverLetter
  return ['Match Notes', ...generated.matchNotes.map((note) => `- ${note}`), '', 'Keywords', generated.keywords.join(', ')].join(
    '\n',
  )
}

function buildCompanySignals(jobs: Job[]) {
  const signals = jobs.reduce<Record<string, { name: string; count: number; locations: string[]; tags: string[] }>>(
    (acc, job) => {
      acc[job.company] ||= { name: job.company, count: 0, locations: [], tags: [] }
      acc[job.company].count += 1
      acc[job.company].locations = Array.from(new Set([...acc[job.company].locations, job.location]))
      acc[job.company].tags = Array.from(new Set([...acc[job.company].tags, ...job.tags]))
      return acc
    },
    {},
  )

  return Object.values(signals)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

function buildExternalJobBoards(filters: JobFilters) {
  const query = filters.query.trim()
  const location = 'United States'

  return [
    {
      name: 'Simplify',
      signal: 'Curated jobs',
      detail: 'Internships, new-grad roles, experienced roles, and saved application workflow.',
      url: buildSimplifyUrl(query, location),
    },
    {
      name: 'JobRight',
      signal: 'AI matches',
      detail: 'Role relevance, resume alignment, and referral discovery for active job searches.',
      url: buildJobRightUrl(query, location, filters.workMode),
    },
    {
      name: 'LinkedIn Jobs',
      signal: 'Network reach',
      detail: 'Broad company coverage with date, location, experience, and employment filters.',
      url: buildLinkedInJobsUrl(filters),
    },
  ]
}

function buildSimplifyUrl(query: string, location: string) {
  const url = new URL('https://simplify.jobs/jobs')
  if (query) url.searchParams.set('query', query)
  url.searchParams.set('location', location)
  return url.toString()
}

function buildJobRightUrl(query: string, location: string, workMode: JobFilters['workMode']) {
  const url = new URL('https://jobright.ai/')
  if (query) url.searchParams.set('jobTitle', query)
  url.searchParams.set('country', location)
  if (workMode !== 'any') url.searchParams.set('workModel', workMode)
  return url.toString()
}

function buildLinkedInJobsUrl(filters: JobFilters) {
  const url = new URL('https://www.linkedin.com/jobs/search/')
  const query = filters.query.trim()
  if (query) url.searchParams.set('keywords', query)
  url.searchParams.set('location', 'United States')
  url.searchParams.set('sortBy', 'DD')
  url.searchParams.set('f_TPR', `r${Math.max(1, filters.postedWithinDays) * 86400}`)

  const workType = linkedInWorkType(filters.workMode)
  if (workType) url.searchParams.set('f_WT', workType)

  const jobType = linkedInJobType(filters.jobType)
  if (jobType) url.searchParams.set('f_JT', jobType)

  const experience = linkedInExperience(filters.seniority)
  if (experience) url.searchParams.set('f_E', experience)

  return url.toString()
}

function linkedInWorkType(workMode: JobFilters['workMode']) {
  if (workMode === 'onsite') return '1'
  if (workMode === 'remote') return '2'
  if (workMode === 'hybrid') return '3'
  return ''
}

function linkedInJobType(jobType: string) {
  const normalized = jobType.toLowerCase()
  if (normalized === 'full-time') return 'F'
  if (normalized === 'part-time') return 'P'
  if (normalized === 'contract') return 'C'
  if (normalized === 'temporary') return 'T'
  if (normalized === 'internship') return 'I'
  if (normalized === 'volunteer') return 'V'
  return ''
}

function linkedInExperience(seniority: string) {
  const normalized = seniority.toLowerCase()
  if (normalized === 'entry') return '2'
  if (normalized === 'mid-level') return '3,4'
  if (normalized === 'senior') return '4'
  if (normalized === 'lead') return '5'
  if (normalized === 'executive') return '6'
  return ''
}

async function readResumeText(file: File) {
  const textFriendly = file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(file.name)
  return textFriendly ? file.text() : ''
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)
}

function getRouteFromLocation(): AppRoute {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  return routeConfig.find((item) => item.path === path)?.route || 'dashboard'
}

function pathForRoute(route: AppRoute) {
  return routeConfig.find((item) => item.route === route)?.path || '/'
}

function getPageMeta(route: AppRoute) {
  if (route === 'jobs') {
    return {
      eyebrow: 'United States job search',
      title: 'Find authentic English-language roles in the United States.',
    }
  }
  if (route === 'tailor') {
    return {
      eyebrow: 'Resume tailoring workspace',
      title: 'Tailor your resume and cover letter for one role at a time.',
    }
  }
  if (route === 'saved-jobs') {
    return {
      eyebrow: 'Saved job command center',
      title: 'Manage saved jobs, statuses, and next actions.',
    }
  }
  if (route === 'resume-vault') {
    return {
      eyebrow: 'Candidate data vault',
      title: 'Store your resume, profile, target roles, and portfolio.',
    }
  }
  if (route === 'tracker') {
    return {
      eyebrow: 'Application pipeline',
      title: 'Track every saved role and generated application package.',
    }
  }
  if (route === 'settings') {
    return {
      eyebrow: 'Firebase workspace',
      title: 'Check authentication, storage, database, and live job readiness.',
    }
  }
  return {
    eyebrow: 'ApplyForge AI',
    title: 'Your professional US job application workspace.',
  }
}

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem('applyforge.theme')
  if (stored === 'light' || stored === 'dark' || stored === 'default') {
    return stored
  }
  return 'default'
}

export default App
