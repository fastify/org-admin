import { exit } from 'node:process'
import { confirm } from './utils/input.js'

/**
 * Removes `username` from every GitHub team they belong to in `org`, adds them
 * to the `emeritus` team when it exists. NPM needs no action since the release
 * workflow already covers it.
 * Prompts for confirmation before any change; in `dryRun` mode logs what
 * would happen without making the mutations.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, dryRun: boolean }} options
 * @returns {Promise<void>} Resolves once the GitHub cleanup is done.
 *   Calls `process.exit(0)` if the user declines the confirmation prompt.
 * @throws {Error} Propagates errors from `client.getUserInfo`, `client.getOrgData`,
 *   `client.getOrgChart`, `client.removeUserFromTeam`, or `client.addUserToTeam`.
 */
export default async function offboard ({ logger, client }, { org, username, dryRun }) {
  const joiningUser = await client.getUserInfo(username)
  if (!await confirm(`Are you sure you want to offboard ${joiningUser.login} [${joiningUser.name}] to ${org}?`)) {
    logger.warn('Aborting offboarding')
    exit(0)
  }

  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)
  const orgTeams = await client.getOrgChart(orgData)
  const emeritusTeam = orgTeams.find(team => team.slug === 'emeritus')

  /** GitHub Cleanup */
  const userTeams = orgTeams.filter(t => t.members.find(m => m.login === joiningUser.login))

  for (const team of userTeams) {
    if (dryRun) {
      logger.warn('[DRY RUN] This user %s will be removed from team %s', joiningUser.login, team.slug)
      continue
    }

    await client.removeUserFromTeam(orgData.name, team.slug, joiningUser.login)
    logger.info('Removed %s from team %s', joiningUser.login, team.slug)
  }

  if (emeritusTeam) {
    if (dryRun) {
      logger.warn('[DRY RUN] This user %s will be added to emeritus team', joiningUser.login)
    } else {
      await client.addUserToTeam(orgData.name, emeritusTeam.slug, joiningUser.login)
      logger.info('Added %s to emeritus team', joiningUser.login)
    }
  }

  logger.info('GitHub offboarding completed for user %s ✅ ', joiningUser.login)

  logger.info('the NPM configuration is already covered: our release workflow follows the instructions at https://github.com/orgs/fastify/discussions/102')
}
