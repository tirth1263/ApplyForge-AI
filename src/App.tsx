import { useEffect, useMemo, useState, type ReactNode } from 'react'
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

const statuses: ApplicationStatus[] = [
  'Saved',
  'Tailored',
  'Applied',
  'Interview',
  'Offer',
  'Rejected',
]

const initialFilters: JobFilters = {
  query: '',
  location: '',
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

type ThemePreference = 'default' | 'light' | 'dark'

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
  const [user, setUser] = useState<User | null>(null)
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [profile, setProfile] = useState<UserProfile>(emptyProfile)
  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([])
  const [applications, setApplications] = useState<SavedApplication[]>([])
  const [filters, setFilters] = useState<JobFilters>(initialFilters)
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
    let active = true

    async function loadInitialJobs() {
      setSearching(true)
      setStatus('Loading real open roles')
      try {
        const response = await searchJobs(initialFilters)
        if (!active) return
        setJobs(response.jobs)
        setProviders(response.providers)
        setSelectedJob(response.jobs[0] ?? null)
        setStatus(`${response.jobs.length} real roles loaded`)
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

  const companySignals = useMemo(() => buildCompanySignals(jobs), [jobs])

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
      { label: 'Open roles', value: jobs.length, icon: BriefcaseBusiness },
      { label: 'Saved jobs', value: savedJobs.length, icon: Save },
      { label: 'Applications', value: applications.length, icon: ClipboardList },
      { label: 'Interviews', value: statusCounts.Interview, icon: CalendarClock },
    ],
    [applications.length, jobs.length, savedJobs.length, statusCounts.Interview],
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
    setStatus('Searching global roles')
    try {
      const response = await searchJobs(filters)
      setJobs(response.jobs)
      setProviders(response.providers)
      setSelectedJob(response.jobs[0] ?? null)
      setStatus(`${response.jobs.length} roles found`)
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
      setStatus(`Saved ${job.title}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save job')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerate() {
    if (firebaseConfigIsComplete && !user) {
      setStatus('Sign in with Google to generate and save documents')
      return
    }

    setGenerating(true)
    setStatus('Generating resume and letter')
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
      setStatus('Application package saved')
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
    setStatus(`Loaded ${job.company}`)
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
      <aside className="sidebar" aria-label="Primary">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>ApplyForge AI</strong>
            <span>Global job application OS</span>
          </div>
        </div>

        <nav className="nav-list">
          <a href="#dashboard" className="active">
            <LayoutDashboard size={18} />
            Dashboard
          </a>
          <a href="#jobs">
            <Search size={18} />
            Jobs
          </a>
          <a href="#vault">
            <FileText size={18} />
            Resume Vault
          </a>
          <a href="#studio">
            <PenLine size={18} />
            AI Studio
          </a>
          <a href="#tracker">
            <ClipboardList size={18} />
            Tracker
          </a>
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
          <p>{user ? user.email : 'Google sign-in required for cloud saves'}</p>
        </div>
      </aside>

      <main className="workspace" id="dashboard">
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
            <span className="eyebrow">ApplyForge Firebase project</span>
            <h1>Search global roles, tailor every application, and track the full pipeline.</h1>
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

        <section className="workspace-grid">
          <div className="primary-column">
            <section className="tool-panel" id="jobs" aria-labelledby="jobs-title">
              <PanelTitle
                eyebrow="Worldwide role search"
                title="Jobs and Hiring Companies"
                icon={<Globe2 size={20} />}
                action={
                  <button className="button primary" type="button" onClick={handleSearch}>
                    {searching ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
                    Search
                  </button>
                }
              />

              <div className="filters">
                <FieldIcon icon={<Search size={16} />}>
                  <input
                    value={filters.query}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, query: event.target.value }))
                    }
                    placeholder="Role, company, or skill"
                  />
                </FieldIcon>
                <FieldIcon icon={<MapPin size={16} />}>
                  <input
                    value={filters.location}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, location: event.target.value }))
                    }
                    placeholder="Remote, city, or country"
                  />
                </FieldIcon>
                <FieldIcon icon={<Globe2 size={16} />}>
                  <select
                    value={filters.workMode}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        workMode: event.target.value as JobFilters['workMode'],
                      }))
                    }
                  >
                    <option value="any">Any mode</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="onsite">On-site</option>
                  </select>
                </FieldIcon>
                <FieldIcon icon={<Target size={16} />}>
                  <select
                    value={filters.seniority}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, seniority: event.target.value }))
                    }
                  >
                    <option>Any level</option>
                    <option>Entry</option>
                    <option>Mid-level</option>
                    <option>Senior</option>
                    <option>Lead</option>
                    <option>Executive</option>
                  </select>
                </FieldIcon>
                <FieldIcon icon={<Filter size={16} />}>
                  <select
                    value={filters.jobType}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, jobType: event.target.value }))
                    }
                  >
                    <option>All types</option>
                    <option>Full-time</option>
                    <option>Contract</option>
                    <option>Part-time</option>
                    <option>Internship</option>
                  </select>
                </FieldIcon>
                <FieldIcon icon={<Database size={16} />}>
                  <select
                    value={filters.source}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, source: event.target.value }))
                    }
                  >
                    <option>All sources</option>
                    <option>Remotive</option>
                    <option>Arbeitnow</option>
                  </select>
                </FieldIcon>
                <FieldIcon icon={<CalendarClock size={16} />}>
                  <select
                    value={filters.postedWithinDays}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        postedWithinDays: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </FieldIcon>
              </div>

              <div className="provider-line">
                <span>Real public job listings only</span>
                {providers.map((provider) => (
                  <span key={provider}>Source: {provider}</span>
                ))}
              </div>

              <div className="job-list">
                {jobs.length ? (
                  jobs.map((job) => (
                    <article
                      className={selectedJob?.id === job.id ? 'job-item selected' : 'job-item'}
                      key={job.id}
                    >
                      <div className="job-main">
                        <div className="job-title-row">
                          <h3>{job.title}</h3>
                          <span>{job.workMode}</span>
                        </div>
                        <p className="company-line">
                          <Building2 size={15} />
                          {job.company} · {job.location}
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
                        <button className="button secondary" type="button" onClick={() => loadJobIntoStudio(job)}>
                          <PenLine size={16} />
                          Tailor
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => handleSaveJob(job)}
                          disabled={saving}
                          title="Save job"
                        >
                          <Save size={17} />
                        </button>
                        <a className="icon-button" href={job.url} target="_blank" rel="noreferrer" title="Open job">
                          <ExternalLink size={17} />
                        </a>
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyState icon={<Search size={24} />} title="No matching roles" detail="Try a broader search." />
                )}
              </div>
            </section>

            <section className="tool-panel studio-panel" id="studio" aria-labelledby="studio-title">
              <PanelTitle
                eyebrow="AI application studio"
                title="Tailored Resume and Cover Letter"
                icon={<Sparkles size={20} />}
                action={
                  <button
                    className="button primary"
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                  >
                    {generating ? <Loader2 className="spin" size={17} /> : <Send size={17} />}
                    Generate
                  </button>
                }
              />

              <div className="studio-grid">
                <div className="form-stack">
                  <div className="two-fields">
                    <label>
                      Role
                      <input
                        value={form.role}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, role: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      Company
                      <input
                        value={form.company}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, company: event.target.value }))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Writing style
                    <select
                      value={form.tone}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, tone: event.target.value }))
                      }
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
                        setForm((current) => ({ ...current, resume }))
                        setProfile((current) => ({ ...current, masterResume: resume }))
                      }}
                    />
                  </label>
                  <label>
                    Job description
                    <textarea
                      value={form.jobDescription}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, jobDescription: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="output-surface">
                  <div className="tabs" role="tablist" aria-label="Generated output">
                    <button
                      className={activeOutput === 'resume' ? 'active' : ''}
                      type="button"
                      onClick={() => setActiveOutput('resume')}
                    >
                      <FileText size={16} />
                      Resume
                    </button>
                    <button
                      className={activeOutput === 'letter' ? 'active' : ''}
                      type="button"
                      onClick={() => setActiveOutput('letter')}
                    >
                      <PenLine size={16} />
                      Letter
                    </button>
                    <button
                      className={activeOutput === 'notes' ? 'active' : ''}
                      type="button"
                      onClick={() => setActiveOutput('notes')}
                    >
                      <ClipboardList size={16} />
                      Notes
                    </button>
                  </div>

                  <pre>{getCurrentOutput(generated, activeOutput) || 'Generated documents will appear here.'}</pre>

                  <div className="output-actions">
                    <button className="button secondary" type="button" onClick={copyCurrentOutput} disabled={!generated}>
                      <Copy size={16} />
                      Copy
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={downloadCurrentOutput}
                      disabled={!generated}
                    >
                      <Download size={16} />
                      Download
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="tool-panel" id="tracker">
              <PanelTitle
                eyebrow="Application pipeline"
                title="Saved Jobs and Generated Packages"
                icon={<ClipboardList size={20} />}
              />

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
                          <select
                            value={job.status}
                            onChange={(event) =>
                              updateSavedJobStatus(user?.uid, job.id, event.target.value as ApplicationStatus)
                            }
                          >
                            {statuses.map((item) => (
                              <option key={item}>{item}</option>
                            ))}
                          </select>
                          <button
                            className="icon-button"
                            type="button"
                            title="Remove saved job"
                            onClick={() => deleteSavedJob(user?.uid, job.id)}
                          >
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
                          <button type="button" onClick={() => loadApplication(application)}>
                            <strong>{application.role}</strong>
                            <span>
                              {application.company} · {formatDate(application.createdAt)}
                            </span>
                          </button>
                          <select
                            value={application.status}
                            onChange={(event) =>
                              updateApplicationStatus(
                                user?.uid,
                                application.id,
                                event.target.value as ApplicationStatus,
                              )
                            }
                          >
                            {statuses.map((item) => (
                              <option key={item}>{item}</option>
                            ))}
                          </select>
                        </article>
                      ))
                    ) : (
                      <EmptyState
                        icon={<Sparkles size={22} />}
                        title="No packages yet"
                        detail="Generate one from the AI studio."
                      />
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="insights-column" aria-label="Workspace controls">
            <section className="tool-panel compact" id="vault">
              <PanelTitle eyebrow="Candidate profile" title="Resume Vault" icon={<FileUp size={20} />} />

              <div className="profile-form">
                <label>
                  Full name
                  <input
                    value={profile.fullName}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, fullName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Headline
                  <input
                    value={profile.headline}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, headline: event.target.value }))
                    }
                    placeholder="Product, engineering, operations..."
                  />
                </label>
                <label>
                  Target roles
                  <input
                    value={profile.targetRoles}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, targetRoles: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Preferred locations
                  <input
                    value={profile.preferredLocations}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, preferredLocations: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Portfolio URL
                  <input
                    value={profile.portfolioUrl}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, portfolioUrl: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="upload-row">
                <label className="file-control">
                  <FileUp size={17} />
                  Resume file
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.doc,.docx"
                    onChange={(event) => handleResumeUpload(event.target.files?.[0])}
                  />
                </label>
                {profile.resumeFileUrl && (
                  <a
                    className="icon-button"
                    href={profile.resumeFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open uploaded resume"
                  >
                    <LinkIcon size={17} />
                  </a>
                )}
              </div>
              {uploadProgress !== null && <progress value={uploadProgress} max="100" aria-label="Upload progress" />}
              {profile.resumeFileName && <p className="quiet-line">{profile.resumeFileName}</p>}

              <button
                className="button primary"
                type="button"
                onClick={() => handleProfileSave()}
                disabled={profileSaving}
              >
                {profileSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
                Save profile
              </button>
            </section>

            <section className="tool-panel compact">
              <PanelTitle eyebrow="Company intelligence" title="Hiring Signals" icon={<Building2 size={20} />} />
              <div className="company-list">
                {companySignals.map((company) => (
                  <button
                    key={company.name}
                    type="button"
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        query: company.name,
                        location: company.locations[0] || current.location,
                      }))
                    }
                  >
                    <div>
                      <strong>{company.name}</strong>
                      <span>{company.locations.slice(0, 2).join(' · ')}</span>
                    </div>
                    <span>{company.count}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </section>

            <section className="tool-panel compact" id="setup">
              <PanelTitle eyebrow="Firebase services" title="Cloud Readiness" icon={<ShieldCheck size={20} />} />
              <ul className="setup-list">
                <ReadinessItem done={firebaseConfigIsComplete} icon={<Database size={14} />} label="Web config loaded" />
                <ReadinessItem done={Boolean(user)} icon={<UserRound size={14} />} label="Google Auth session" />
                <ReadinessItem
                  done={Boolean(profile.masterResume || profile.resumeFileUrl)}
                  icon={<FileText size={14} />}
                  label="Resume stored"
                />
                <ReadinessItem
                  done={applications.length > 0}
                  icon={<Sparkles size={14} />}
                  label="AI package saved"
                />
                <ReadinessItem
                  done={providers.length > 0}
                  icon={<Globe2 size={14} />}
                  label="Live job provider"
                />
              </ul>
            </section>
          </aside>
        </section>
      </main>
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

function getCurrentOutput(
  generated: GeneratedAssets | null,
  activeOutput: 'resume' | 'letter' | 'notes',
) {
  if (!generated) return ''

  if (activeOutput === 'resume') return generated.tailoredResume
  if (activeOutput === 'letter') return generated.coverLetter
  return [
    'Match Notes',
    ...generated.matchNotes.map((note) => `- ${note}`),
    '',
    'Keywords',
    generated.keywords.join(', '),
  ].join('\n')
}

function buildCompanySignals(jobs: Job[]) {
  const signals = jobs.reduce<
    Record<string, { name: string; count: number; locations: string[]; tags: string[] }>
  >((acc, job) => {
    acc[job.company] ||= { name: job.company, count: 0, locations: [], tags: [] }
    acc[job.company].count += 1
    acc[job.company].locations = Array.from(new Set([...acc[job.company].locations, job.location]))
    acc[job.company].tags = Array.from(new Set([...acc[job.company].tags, ...job.tags]))
    return acc
  }, {})

  return Object.values(signals)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
}

async function readResumeText(file: File) {
  const textFriendly =
    file.type.startsWith('text/') || /\.(txt|md|markdown|csv)$/i.test(file.name)
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

function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem('applyforge.theme')
  if (stored === 'light' || stored === 'dark' || stored === 'default') {
    return stored
  }
  return 'default'
}

export default App
