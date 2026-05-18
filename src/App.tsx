import { useEffect, useMemo, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import {
  BriefcaseBusiness,
  Building2,
  Check,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  PenLine,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  UserRound,
} from 'lucide-react'
import './App.css'
import {
  firebaseConfigIsComplete,
  auth,
  signInWithGoogle,
  signOutOfGoogle,
} from './lib/firebase'
import {
  generateApplicationAssets,
  saveApplication,
  saveJob,
  searchJobs,
} from './lib/applicationService'
import { mockJobs } from './data/mockJobs'
import type { ApplicationForm, GeneratedAssets, Job, JobFilters } from './types'

const initialFilters: JobFilters = {
  query: 'AI product',
  location: 'Remote',
  workMode: 'any',
  seniority: 'Any level',
  jobType: 'Full-time',
  source: 'All sources',
  postedWithinDays: 30,
  minSalary: 0,
}

const initialForm: ApplicationForm = {
  role: 'AI Product Manager',
  company: 'Northstar Systems',
  resume:
    'Paste your master resume here. Include recent roles, measurable wins, tools, education, certifications, and links you want represented.',
  jobDescription:
    'Paste the target job description here. The AI will extract requirements, keywords, and employer priorities before tailoring the resume and cover letter.',
  tone: 'Confident and concise',
}

const setupItems = [
  'Firebase project selected',
  'Web app environment added',
  'OpenAI secret stored in Functions',
  'Job provider keys stored as secrets',
  'GitHub remote connected',
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [filters, setFilters] = useState<JobFilters>(initialFilters)
  const [jobs, setJobs] = useState<Job[]>(mockJobs)
  const [providers, setProviders] = useState<string[]>(['Local demo feed'])
  const [selectedJob, setSelectedJob] = useState<Job | null>(mockJobs[0])
  const [form, setForm] = useState<ApplicationForm>(initialForm)
  const [generated, setGenerated] = useState<GeneratedAssets | null>(null)
  const [activeOutput, setActiveOutput] = useState<'resume' | 'letter' | 'notes'>('resume')
  const [searching, setSearching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Ready')

  useEffect(() => {
    if (!auth) {
      return
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setAuthLoading(false)
    })
  }, [])

  const stats = useMemo(
    () => [
      { label: 'Open roles', value: jobs.length.toString(), icon: BriefcaseBusiness },
      { label: 'Sources', value: providers.length.toString(), icon: Globe2 },
      { label: 'Saved user', value: user ? 'Cloud' : 'Local', icon: Lock },
      { label: 'AI studio', value: generated ? 'Ready' : 'Draft', icon: Sparkles },
    ],
    [generated, jobs.length, providers.length, user],
  )

  const completion = useMemo(() => {
    const checks = [
      firebaseConfigIsComplete,
      Boolean(user),
      Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID),
      Boolean(generated),
      providers.some((provider) => provider !== 'Local demo feed'),
    ]
    return Math.round((checks.filter(Boolean).length / setupItems.length) * 100)
  }, [generated, providers, user])

  async function handleSignIn() {
    try {
      setStatus('Opening Google sign-in')
      await signInWithGoogle()
      setStatus('Signed in')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign-in failed')
    }
  }

  async function handleSignOut() {
    await signOutOfGoogle()
    setStatus('Signed out')
  }

  async function handleSearch() {
    setSearching(true)
    setStatus('Searching jobs')
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

  async function handleGenerate() {
    setGenerating(true)
    setStatus('Generating application assets')
    try {
      const assets = await generateApplicationAssets(form)
      setGenerated(assets)
      setActiveOutput('resume')
      setStatus('Resume and cover letter generated')
      await saveApplication(user?.uid, {
        role: form.role,
        company: form.company,
        jobId: selectedJob?.id,
        assets,
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerating(false)
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

  function loadJobIntoStudio(job: Job) {
    setSelectedJob(job)
    setForm((current) => ({
      ...current,
      role: job.title,
      company: job.company,
      jobDescription: job.description,
    }))
    setStatus(`Loaded ${job.company} into studio`)
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
    link.download = `${form.company || 'company'}-${form.role || 'role'}-${activeOutput}.txt`
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
            <strong>ApplyAtlas AI</strong>
            <span>Job command center</span>
          </div>
        </div>

        <nav className="nav-list">
          <a href="#dashboard" className="active">
            <LayoutDashboard size={18} />
            Dashboard
          </a>
          <a href="#jobs">
            <Search size={18} />
            Job Search
          </a>
          <a href="#studio">
            <PenLine size={18} />
            Resume Tailor
          </a>
          <a href="#tracker">
            <ClipboardList size={18} />
            Tracker
          </a>
          <a href="#setup">
            <Settings size={18} />
            Firebase
          </a>
        </nav>

        <div className="sidebar-foot">
          <div className="sync-meter">
            <div>
              <span>Setup</span>
              <strong>{completion}%</strong>
            </div>
            <progress value={completion} max="100" aria-label="Setup completion" />
          </div>
          <p>{firebaseConfigIsComplete ? 'Firebase config detected' : 'Demo mode active'}</p>
        </div>
      </aside>

      <main className="workspace" id="dashboard">
        <header className="topbar">
          <div>
            <span className="eyebrow">Global application workspace</span>
            <h1>Find roles, tailor documents, and track every application.</h1>
          </div>
          <div className="account-area">
            <span className="status-pill">{status}</span>
            {user ? (
              <button className="button secondary" type="button" onClick={handleSignOut}>
                <LogOut size={17} />
                {user.displayName || 'Sign out'}
              </button>
            ) : (
              <button
                className="button primary"
                type="button"
                onClick={handleSignIn}
                disabled={!firebaseConfigIsComplete || authLoading}
                title={
                  firebaseConfigIsComplete
                    ? 'Sign in with Google'
                    : 'Add Firebase web config to enable sign-in'
                }
              >
                <UserRound size={17} />
                {authLoading ? 'Checking' : 'Sign in'}
              </button>
            )}
          </div>
        </header>

        <section className="stat-strip" aria-label="Workspace metrics">
          {stats.map((item) => {
            const Icon = item.icon
            return (
              <div className="metric" key={item.label}>
                <Icon size={19} />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            )
          })}
        </section>

        <section className="workspace-grid">
          <div className="primary-column">
            <section className="tool-panel" id="jobs" aria-labelledby="jobs-title">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Live market scan</span>
                  <h2 id="jobs-title">Job Search</h2>
                </div>
                <button className="icon-button" type="button" onClick={handleSearch} title="Refresh jobs">
                  {searching ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
                </button>
              </div>

              <div className="filters">
                <label>
                  <Search size={16} />
                  <input
                    value={filters.query}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, query: event.target.value }))
                    }
                    placeholder="Role, skill, company"
                  />
                </label>
                <label>
                  <MapPin size={16} />
                  <input
                    value={filters.location}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, location: event.target.value }))
                    }
                    placeholder="City, country, remote"
                  />
                </label>
                <label>
                  <Globe2 size={16} />
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
                </label>
                <label>
                  <BriefcaseBusiness size={16} />
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
                </label>
                <label>
                  <Filter size={16} />
                  <select
                    value={filters.jobType}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, jobType: event.target.value }))
                    }
                  >
                    <option>Full-time</option>
                    <option>Contract</option>
                    <option>Part-time</option>
                    <option>Internship</option>
                  </select>
                </label>
                <button className="button primary search-button" type="button" onClick={handleSearch}>
                  {searching ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
                  Search
                </button>
              </div>

              <div className="provider-line">
                {providers.map((provider) => (
                  <span key={provider}>{provider}</span>
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
                          {job.tags.slice(0, 4).map((tag) => (
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
                  <div className="empty-state">
                    <Search size={24} />
                    <strong>No matching roles</strong>
                    <span>Broaden the filters or add provider API keys.</span>
                  </div>
                )}
              </div>
            </section>

            <section className="tool-panel studio-panel" id="studio" aria-labelledby="studio-title">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">AI application studio</span>
                  <h2 id="studio-title">Resume Tailor and Cover Letter</h2>
                </div>
                <button
                  className="button primary"
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
                  Generate
                </button>
              </div>

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
                    Tone
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
                    Master Resume
                    <textarea
                      value={form.resume}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, resume: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Job Description
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
          </div>

          <aside className="insights-column" aria-label="Application insights">
            <section className="tool-panel compact" id="tracker">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Pipeline</span>
                  <h2>Application Tracker</h2>
                </div>
                <ClipboardList size={20} />
              </div>
              <div className="pipeline">
                {['Saved', 'Tailored', 'Applied', 'Interviewing'].map((stage, index) => (
                  <div key={stage}>
                    <span>{stage}</span>
                    <strong>{index === 0 ? jobs.length : index === 1 && generated ? 1 : 0}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="tool-panel compact">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Hiring map</span>
                  <h2>Global Signals</h2>
                </div>
                <Globe2 size={20} />
              </div>
              <div className="region-grid">
                {['Americas', 'Europe', 'APAC', 'Remote'].map((region, index) => (
                  <div key={region}>
                    <span>{region}</span>
                    <strong>{Math.max(1, jobs.length - index)}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="tool-panel compact" id="setup">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Launch readiness</span>
                  <h2>Firebase and GitHub</h2>
                </div>
                <Check size={20} />
              </div>
              <ul className="setup-list">
                {setupItems.map((item, index) => {
                  const done =
                    (index === 0 && firebaseConfigIsComplete) ||
                    (index === 1 && firebaseConfigIsComplete) ||
                    (index === 2 && false) ||
                    (index === 3 && providers.some((provider) => provider !== 'Local demo feed')) ||
                    (index === 4 && false)
                  return (
                    <li key={item} className={done ? 'done' : ''}>
                      <span>{done ? <Check size={14} /> : index + 1}</span>
                      {item}
                    </li>
                  )
                })}
              </ul>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function getCurrentOutput(generated: GeneratedAssets | null, activeOutput: 'resume' | 'letter' | 'notes') {
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

export default App
