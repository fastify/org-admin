import { writeFileSync } from 'node:fs'
import { npmJson } from './utils/npm-json.js'

const COMMANDS_FILE = './npm-org-sync.sh'
const REPORT_FILE = './npm-org-sync.json'

/**
 * The npm teams that act as "release buckets". Each managed bucket (except
 * `deprecated`) is driven by a GitHub topic: a package belongs to the bucket
 * whose topic its repository carries. The `deprecated` bucket is special — it is
 * driven by the package's npm deprecation status, not by a topic.
 */
const BUCKET_TOPIC = {
  core: 'fastify-core',
  libraries: 'fastify-library',
  plugins: 'fastify-plugin',
}
const MANAGED_TEAMS = [...Object.keys(BUCKET_TOPIC), 'deprecated']
const DEPRECATED_TEAM = 'deprecated'
const DEVELOPERS_TEAM = 'developers'
const UNKNOWN_BUCKET = 'unknown'

/**
 * Reconciles the npm org teams with the GitHub topics of each package's repository.
 *
 * For every package published under the org it computes the bucket it *should*
 * live in (from the repo topic, or `deprecated` when the package is deprecated on
 * npm, or `unknown` when no topic matches) and compares it with the team the
 * package currently belongs to. It never writes to npm: the required changes are
 * printed as an aggregated summary and written to a shell script of `npm access`
 * commands to be reviewed and run manually.
 *
 * Detected situations:
 *  1. package in no team at all → grant `developers` (read-only) + its bucket
 *  2. package deprecated on npm → move to the `deprecated` team
 *  3. package no longer belongs to a team (topic changed) → revoke
 *  4. package should be added to a team (topic changed) → grant
 *  5. package matches no bucket topic → reported under `unknown`
 *
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string }} options - Command options.
 * @returns {Promise<void>}
 */
export default async function syncNpmOrg ({ client, logger }, { org }) {
  logger.info('Running sync-npm-org for organization: %s', org)

  // 1. Download the org's package list.
  const packages = npmListOrgPackages(org)
  logger.info('Found %s packages under @%s', packages.length, org)

  // 2. Current membership of each managed team + the developers team.
  const teamPackages = {}
  for (const team of [...MANAGED_TEAMS, DEVELOPERS_TEAM]) {
    teamPackages[team] = new Set(npmListTeamPackages(org, team))
    logger.debug('Team %s owns %s packages', team, teamPackages[team].size)
  }

  // 3. GitHub topics per repository, indexed by repo name.
  const repos = await client.getOrgRepositories(org)
  const topicsByRepo = new Map(repos.map((repo) => [repo.name.toLowerCase(), repo.topics]))
  logger.info('Fetched topics for %s repositories', repos.length)

  // 4. For each package resolve its repo + deprecation status from the registry,
  //    classify it into a bucket and diff against the current team membership.
  const results = []
  for (const pkg of packages) {
    const meta = await fetchPackageMeta(pkg)
    const topics = meta.repo ? (topicsByRepo.get(meta.repo.toLowerCase()) ?? null) : null
    const expected = classify({ deprecated: meta.deprecated, topics })
    const currentTeams = MANAGED_TEAMS.filter((team) => teamPackages[team].has(pkg))
    const inDevelopers = teamPackages[DEVELOPERS_TEAM].has(pkg)

    results.push(reconcile({ pkg, org, expected, currentTeams, inDevelopers, meta, topics }))
  }

  printSummary(logger, results)
  writeArtifacts(logger, org, results)
}

/**
 * Computes the bucket a package should belong to. Deprecation wins over topics;
 * a package with no matching topic falls into the `unknown` bucket.
 * @param {{ deprecated: boolean, topics: string[]|null }} input - Classification input.
 * @returns {string} The expected bucket (`core`/`libraries`/`plugins`/`deprecated`/`unknown`).
 */
function classify ({ deprecated, topics }) {
  if (deprecated) {
    return DEPRECATED_TEAM
  }
  for (const [bucket, topic] of Object.entries(BUCKET_TOPIC)) {
    if (topics?.includes(topic)) {
      return bucket
    }
  }
  return UNKNOWN_BUCKET
}

/**
 * Diffs a single package's current team membership against its expected bucket and
 * produces the list of `npm access` commands needed to bring it in sync, together
 * with a human-readable list of the situations detected.
 * @param {object} input - Reconciliation input.
 * @param {string} input.pkg - The package name.
 * @param {string} input.org - The organization name.
 * @param {string} input.expected - The expected bucket.
 * @param {string[]} input.currentTeams - The managed teams the package is currently in.
 * @param {boolean} input.inDevelopers - Whether the package is in the developers team.
 * @param {{ repo: string|null, deprecated: boolean }} input.meta - Registry metadata.
 * @param {string[]|null} input.topics - The repo topics (null when the repo is unknown).
 * @returns {{ pkg: string, expected: string, currentTeams: string[], repo: string|null, situations: string[], commands: string[] }} The reconciliation result.
 */
function reconcile ({ pkg, org, expected, currentTeams, inDevelopers, meta, topics }) {
  const situations = []
  const commands = []
  const grant = (team, level) => commands.push(`npm access grant ${level} ${org}:${team} ${pkg}`)
  const revoke = (team) => commands.push(`npm access revoke ${org}:${team} ${pkg}`)
  const bucketLevel = (team) => (team === DEPRECATED_TEAM ? 'read-only' : 'read-write')

  const inAnyTeam = currentTeams.length > 0 || inDevelopers

  // (5) No topic matched and the package is not deprecated: report only.
  if (expected === UNKNOWN_BUCKET) {
    if (meta.repo === null) {
      situations.push('no repository resolved on npm')
    } else if (topics === null) {
      situations.push(`repository ${meta.repo} not found in GitHub org (topics unavailable)`)
    } else {
      situations.push('no bucket topic on repository')
    }
    // Still surface a stale membership so it is not silently kept.
    for (const team of currentTeams) {
      situations.push(`still in ${team} without a matching topic — review`)
    }
    return { pkg, expected, currentTeams, repo: meta.repo, situations, commands }
  }

  // (1) Package not added to any team: onboard it to developers (read-only) + bucket.
  if (!inAnyTeam) {
    situations.push('not in any team → add to developers (read-only) + bucket')
    grant(DEVELOPERS_TEAM, 'read-only')
  }

  // (2) Deprecated package that is not yet in the deprecated team: move it there.
  if (expected === DEPRECATED_TEAM) {
    if (!currentTeams.includes(DEPRECATED_TEAM)) {
      situations.push('deprecated on npm → move to deprecated team')
    }
  }

  // (3) In a team it no longer belongs to (topic change / deprecation).
  for (const team of currentTeams) {
    if (team !== expected) {
      situations.push(`no longer belongs to ${team} → revoke`)
      revoke(team)
    }
  }

  // (4) Should be in the expected team but is not yet.
  if (!currentTeams.includes(expected)) {
    if (inAnyTeam) {
      situations.push(`should be in ${expected} → grant`)
    }
    grant(expected, bucketLevel(expected))
  }

  return { pkg, expected, currentTeams, repo: meta.repo, situations, commands }
}

/**
 * Prints an aggregated, per-bucket summary of the reconciliation to the logger.
 * @param {import('pino').Logger} logger - The logger.
 * @param {object[]} results - The reconciliation results.
 * @returns {void}
 */
function printSummary (logger, results) {
  const byBucket = {}
  for (const result of results) {
    byBucket[result.expected] = (byBucket[result.expected] ?? 0) + 1
  }

  logger.info('Expected bucket distribution: %o', byBucket)

  const changed = results.filter((result) => result.commands.length > 0)
  const unknown = results.filter((result) => result.expected === UNKNOWN_BUCKET)

  logger.info('%s package(s) need changes, %s already in sync', changed.length, results.length - changed.length)

  for (const result of changed) {
    logger.info('• %s [%s] → %s', result.pkg, result.currentTeams.join(', ') || 'none', result.expected)
    for (const situation of result.situations) {
      logger.info('    - %s', situation)
    }
  }

  if (unknown.length > 0) {
    logger.warn('%s package(s) fell into the "unknown" bucket (missing topic):', unknown.length)
    for (const result of unknown) {
      logger.warn('    ⚠ %s (repo: %s)', result.pkg, result.repo ?? 'unresolved')
    }
  }
}

/**
 * Writes the machine-readable report and the shell script of npm commands.
 * @param {import('pino').Logger} logger - The logger.
 * @param {string} org - The organization name.
 * @param {object[]} results - The reconciliation results.
 * @returns {void}
 */
function writeArtifacts (logger, org, results) {
  writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2))
  logger.info('Report written to %s', REPORT_FILE)

  const lines = [
    '#!/usr/bin/env bash',
    '# npm org sync commands — generated by `sync-npm-org`. Review before running.',
    '# These are WRITE operations against the npm org; run them manually.',
    'set -euo pipefail',
    '',
  ]
  for (const result of results) {
    if (result.commands.length === 0) {
      continue
    }
    lines.push(`# ${result.pkg}: ${result.situations.join('; ')}`)
    lines.push(...result.commands, '')
  }

  writeFileSync(COMMANDS_FILE, lines.join('\n'))
  logger.info('Commands written to %s', COMMANDS_FILE)
}

/**
 * Lists all packages published under an org via the npm CLI.
 * @param {string} org - The organization name.
 * @returns {string[]} The package names.
 */
function npmListOrgPackages (org) {
  return Object.keys(npmJson(['access', 'list', 'packages', org]))
}

/**
 * Lists the packages a given team has access to via the npm CLI. Returns an empty
 * array when the team does not exist yet.
 * @param {string} org - The organization name.
 * @param {string} team - The team slug.
 * @returns {string[]} The package names.
 */
function npmListTeamPackages (org, team) {
  try {
    return Object.keys(npmJson(['access', 'list', 'packages', `${org}:${team}`]))
  } catch {
    return []
  }
}

/**
 * Fetches a package's registry metadata to resolve its GitHub repository name and
 * whether its latest version is deprecated. Reads are public and unauthenticated.
 * @param {string} pkg - The package name.
 * @returns {Promise<{ repo: string|null, deprecated: boolean }>} The resolved metadata.
 */
async function fetchPackageMeta (pkg) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg).replace(/%40/g, '@')}`)
  if (!response.ok) {
    return { repo: null, deprecated: false }
  }
  const meta = await response.json()
  const latest = meta['dist-tags']?.latest
  const latestVersion = latest ? meta.versions?.[latest] : undefined
  const repoUrl = latestVersion?.repository?.url ?? meta.repository?.url ?? null

  return {
    repo: parseRepoName(repoUrl),
    deprecated: Boolean(latestVersion?.deprecated),
  }
}

/**
 * Extracts the GitHub repository name from a package `repository.url` field.
 * @param {string|null} url - The repository URL.
 * @returns {string|null} The repository name, or null when it cannot be parsed.
 */
function parseRepoName (url) {
  if (!url) {
    return null
  }
  const match = url.match(/github\.com[:/][^/]+\/([^/#.]+)/)
  return match ? match[1] : null
}
