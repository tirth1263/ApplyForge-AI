import type { Job } from '../types'

export const mockJobs: Job[] = [
  {
    id: 'demo-product-ai-remote',
    title: 'AI Product Manager',
    company: 'Northstar Systems',
    location: 'Remote - United States, Canada, Europe',
    workMode: 'remote',
    source: 'Demo market feed',
    url: 'https://example.com/jobs/ai-product-manager',
    description:
      'Own AI roadmap, translate customer needs into product requirements, partner with engineering and growth, and launch responsible AI features for enterprise teams.',
    salary: '$145k - $185k',
    postedAt: new Date().toISOString(),
    tags: ['AI', 'Product Strategy', 'Enterprise SaaS'],
  },
  {
    id: 'demo-frontend-london',
    title: 'Senior Frontend Engineer',
    company: 'SignalForge',
    location: 'London, United Kingdom',
    workMode: 'hybrid',
    source: 'Demo market feed',
    url: 'https://example.com/jobs/senior-frontend-engineer',
    description:
      'Build React dashboards for global recruiting teams, improve application workflows, and lead UI architecture across a modern TypeScript stack.',
    salary: 'GBP 95k - 120k',
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    tags: ['React', 'TypeScript', 'Design Systems'],
  },
  {
    id: 'demo-data-berlin',
    title: 'People Analytics Data Scientist',
    company: 'TalentGrid',
    location: 'Berlin, Germany',
    workMode: 'onsite',
    source: 'Demo market feed',
    url: 'https://example.com/jobs/people-analytics-data-scientist',
    description:
      'Model workforce trends, create hiring intelligence dashboards, and help leaders identify where the company should recruit next.',
    salary: 'EUR 100k - 130k',
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 6).toISOString(),
    tags: ['Python', 'Analytics', 'Hiring Intelligence'],
  },
  {
    id: 'demo-cloud-singapore',
    title: 'Cloud Solutions Architect',
    company: 'OrbitWorks',
    location: 'Singapore',
    workMode: 'hybrid',
    source: 'Demo market feed',
    url: 'https://example.com/jobs/cloud-solutions-architect',
    description:
      'Design secure cloud architectures, support enterprise migration programs, and work directly with customer engineering leaders across APAC.',
    salary: 'SGD 170k - 220k',
    postedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    tags: ['Cloud', 'Security', 'Customer Architecture'],
  },
]
