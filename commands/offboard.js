import { exit } from 'node:process'
import { confirm } from './utils/input.js'
import { removeFromNpm } from './utils/remove-from-npm.js'
/**
 * Offboards a user from an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, joiningTeams: Set, dryRun: boolean }} options
 * @returns {Promise<void>}
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

  /** NPM Cleanup */
  const userNpmTeams = [
    { slug: 'developers' }, // NPM has a default team for every org
    ...userTeams
  ]

  for (const team of userNpmTeams) {
    if (dryRun) {
      logger.warn('[DRY RUN] This user %s will be removed from NPM team %s', joiningUser.login, team.slug)
      continue
    }

    try {
      logger.debug('Removing %s from NPM team %s', joiningUser.login, team.slug)
      await removeFromNpm(org, team.slug, joiningUser.login)
      logger.info('Removed %s from NPM team %s', joiningUser.login, team.slug)
    } catch (error) {
      logger.error('Failed to remove %s from NPM team %s', joiningUser.login, team.slug)
      logger.error(error)
    }
  }
  logger.info('NPM offboarding completed for user %s ✅ ', joiningUser.login)
}
