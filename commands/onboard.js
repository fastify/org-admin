import { exit } from 'node:process'
import { confirm } from './utils/input.js'
import { listNpmTeams } from './utils/npm-teams.js'

/**
 * Adds `username` to the requested GitHub teams in `org`, then prints the manual
 * steps the operator must follow for NPM (invite URL + `npm team add` commands).
 * Prompts the user for a yes/no confirmation before making any change; in
 * `dryRun` mode logs what would happen without performing the GitHub mutations.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, joiningTeams: Set<string>, dryRun: boolean }} options
 * @returns {Promise<void>} Resolves once GitHub changes are applied and the NPM
 *   instructions have been logged.
 *   Calls `process.exit(0)` if the user declines the confirmation prompt, and
 *   `process.exit(1)` if `joiningTeams` contains slugs that don't exist in `org`.
 * @throws {Error} Propagates errors from `client.getUserInfo`, `client.getOrgData`,
 *   `client.getOrgChart`, or `client.addUserToTeam`.
 */
export default async function onboard ({ client, logger }, { org, username, joiningTeams, dryRun }) {
  const joiningUser = await client.getUserInfo(username)
  if (!await confirm(`Are you sure you want to onboard ${joiningUser.login} [${joiningUser.name}] to ${org}?`)) {
    logger.warn('Aborting onboarding')
    exit(0)
  }

  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)

  const orgTeams = await client.getOrgChart(orgData)
  const destinationTeams = orgTeams.filter(t => joiningTeams.has(t.slug))

  const teamSlugs = new Set(orgTeams.map(t => t.slug))
  const wrongInputTeams = joiningTeams.difference(teamSlugs)
  if (wrongInputTeams.size) {
    logger.error('Team %s not found in organization %s', [...wrongInputTeams], org)
    exit(1)
  }

  if (dryRun) {
    logger.info('[DRY-RUN] This user %s should be added to team %s', joiningUser.login, [...joiningTeams])
  } else {
    for (const targetTeam of destinationTeams) {
      await client.addUserToTeam(org, targetTeam.slug, joiningUser.login)
      logger.info('Added %s to team %s', joiningUser.login, targetTeam.slug)
    }
  }

  logger.info('GitHub onboarding completed for user %s ✅ ', joiningUser.login)

  logger.warn('To complete the NPM onboarding, please following these steps:')
  const npmHandle = joiningUser.socialAccounts.nodes?.find(account => account.provider === 'NPM')?.displayName ?? joiningUser.login

  // This step cannot be automated, there are no API to add members to an org on NPM
  logger.info('1. Invite the user to the organization on NPM: https://www.npmjs.com/org/%s/invite?track=existingOrgAddMembers', org)

  // The npm team layout does not mirror the GitHub teams, so we cannot infer the
  // publish buckets from the GitHub destination teams. List an `add` command for
  // every existing npm team and let the operator run only the needed ones.
  logger.info('2. Add the user to the relevant NPM teams. `developers` is the read-only baseline for every maintainer; the other teams grant publish rights on their packages — run ONLY the commands you need:')
  for (const team of listNpmTeams(org)) {
    logger.info('npm team add @%s:%s %s', org, team, npmHandle)
  }
  logger.info('When it will be done, the NPM onboarding will be completed for user %s ✅ ', npmHandle)
}
