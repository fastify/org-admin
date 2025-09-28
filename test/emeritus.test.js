import test from 'node:test'
import assert from 'node:assert/strict'

import emeritus from '../commands/emeritus.js'

function monthsAgo (n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

function createMockLogger () {
  const infoMessages = []
  const debugMessages = []
  return {
    info: (msg) => { if (typeof msg === 'string') infoMessages.push(msg) },
    debug: (msg) => { if (typeof msg === 'string') debugMessages.push(msg) },
    infoMessages,
    debugMessages
  }
}

function createMockClient (thresholdMonths = 24) {
  const calls = []

  const orgData = { id: 123, name: 'fastify' }

  // Org structure with leads, emeritus, and a core team
  const orgChart = [
    { slug: 'leads', members: [{ login: 'lead1' }] },
    { slug: 'emeritus', members: [{ login: 'already_emeritus' }] },
    {
      slug: 'core',
      members: [
        { login: 'active_user' },
        { login: 'inactive_user' },
        { login: 'boundary_user' },
        { login: 'inactive_no_contrib' },
        // Users may also be in multiple teams
        { login: 'lead1' },
        { login: 'already_emeritus' }
      ]
    }
  ]

  // Default contribution map; will be expanded per membersList when requested
  const contributionsByUser = {
    active_user: { lastPR: monthsAgo(1) },
    inactive_user: { lastIssue: monthsAgo(thresholdMonths + 1) },
    boundary_user: { lastCommit: monthsAgo(thresholdMonths) }, // exactly on the boundary -> NOT emeritus
    lead1: { lastPR: monthsAgo(thresholdMonths + 10) }, // would be emeritus but excluded for being a lead
    already_emeritus: { lastIssue: monthsAgo(thresholdMonths + 2) }, // would be emeritus but already in emeritus team
    inactive_no_contrib: { /* no contributions at all -> emeritus */ }
  }

  const client = {
    calls,
    lastYearsToRead: null,

    async getOrgData (org) {
      calls.push({ method: 'getOrgData', org })
      return { ...orgData, name: org }
    },

    async getOrgChart (orgDataArg) {
      calls.push({ method: 'getOrgChart', orgData: orgDataArg })
      return orgChart
    },

    async getUsersContributions (orgDataArg, membersList, yearsToRead) {
      calls.push({ method: 'getUsersContributions', orgData: orgDataArg, membersList, yearsToRead })
      client.lastYearsToRead = yearsToRead
      return membersList.map(user => ({ user, ...contributionsByUser[user] }))
    },

    async createIssue (owner, repo, title, body, labels) {
      calls.push({ method: 'createIssue', owner, repo, title, body, labels })
      return { number: 1 }
    }
  }

  return client
}

test('emeritus (dry-run): logs the users to move and does not create an issue', async () => {
  const threshold = 24
  const client = createMockClient(threshold)
  const logger = createMockLogger()

  await emeritus({ client, logger }, { org: 'fastify', monthsInactiveThreshold: threshold, dryRun: true })

  // Ensure no issue is created in dry run
  assert.equal(client.calls.some(c => c.method === 'createIssue'), false)

  // It should log the header and each username to be moved
  const lines = logger.infoMessages
  assert.ok(lines.some(l => l.includes('These users should be added to emeritus team')), 'should log dry-run header')

  // Expected users to move: inactive_user and inactive_no_contrib
  assert.ok(lines.some(l => l.includes('- @inactive_user')), 'should list inactive_user')
  assert.ok(lines.some(l => l.includes('- @inactive_no_contrib')), 'should list inactive_no_contrib')

  // Should not list users who are active, leads, or already in emeritus, or on the boundary
  assert.equal(lines.some(l => l.includes('- @active_user')), false, 'active_user should not be listed')
  assert.equal(lines.some(l => l.includes('- @boundary_user')), false, 'boundary_user (exactly on threshold) should not be listed')
  assert.equal(lines.some(l => l.includes('- @lead1')), false, 'lead should not be listed')
  assert.equal(lines.some(l => l.includes('- @already_emeritus')), false, 'already emeritus should not be listed')

  // Confirm yearsToRead passed to getUsersContributions is ceil(threshold/12)
  assert.equal(client.lastYearsToRead, Math.ceil(threshold / 12))
})

test('emeritus (non-dry-run): creates an issue with the list of users to move', async () => {
  const threshold = 24
  const client = createMockClient(threshold)
  const logger = createMockLogger()

  await emeritus({ client, logger }, { org: 'fastify', monthsInactiveThreshold: threshold, dryRun: false })

  const issueCalls = client.calls.filter(c => c.method === 'createIssue')
  assert.equal(issueCalls.length, 1, 'should create exactly one issue')

  const [call] = issueCalls
  assert.equal(call.owner, 'fastify')
  assert.equal(call.repo, 'org-admin')
  assert.equal(call.title, 'Move to emeritus members')
  assert.deepEqual(call.labels, ['question'])

  // Body should mention threshold and include the expected users
  assert.ok(call.body.includes(`more than ${threshold} months`), 'body should mention the threshold')
  assert.ok(call.body.includes('- @inactive_user'))
  assert.ok(call.body.includes('- @inactive_no_contrib'))

  // Body should not include excluded users
  assert.equal(call.body.includes('- @lead1'), false)
  assert.equal(call.body.includes('- @already_emeritus'), false)
  assert.equal(call.body.includes('- @boundary_user'), false)
  assert.equal(call.body.includes('- @active_user'), false)
})

test('emeritus: yearsToRead is computed with Math.ceil(monthsThreshold/12)', async () => {
  const threshold = 13 // should round up to 2 years
  const client = createMockClient(threshold)
  const logger = createMockLogger()

  await emeritus({ client, logger }, { org: 'fastify', monthsInactiveThreshold: threshold, dryRun: true })

  assert.equal(client.lastYearsToRead, 2)
})
