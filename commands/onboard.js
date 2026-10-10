import { exit } from 'node:process'
import { confirm } from './utils/input.js'

/**
 * Adds `username` to the requested GitHub teams in `org`. NPM needs no action
 * since the release workflow already covers it.
 * Prompts the user for a yes/no confirmation before making any change; in
 * `dryRun` mode logs what would happen without performing the GitHub mutations.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, joiningTeams: Set<string>, dryRun: boolean }} options
 * @returns {Promise<void>} Resolves once GitHub changes are applied.
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

  logger.info('the NPM configuration is already covered: our release workflow follows the instructions at https://github.com/orgs/fastify/discussions/102')
}
