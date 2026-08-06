import { exit } from 'node:process'
import { confirm } from './utils/input.js'
import { removeFromNpm } from './utils/remove-from-npm.js'
import { listNpmTeams, listNpmTeamMembers } from './utils/npm-teams.js'
/**
 * Offboards a user from an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string, username: string, joiningTeams: Set, dryRun: boolean }} options - Command options.
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
  // The npm team layout does not mirror the GitHub teams.
  const npmHandle = joiningUser.socialAccounts.nodes?.find(account => account.provider === 'NPM')?.displayName ?? joiningUser.login

  const userNpmTeams = listNpmTeams(org).filter(team => listNpmTeamMembers(org, team).includes(npmHandle))
  logger.info('User %s belongs to %s NPM team(s): %s', npmHandle, userNpmTeams.length, userNpmTeams.join(', ') || 'none')

  for (const team of userNpmTeams) {
    if (dryRun) {
      logger.warn('[DRY RUN] This user %s will be removed from NPM team %s', npmHandle, team)
      continue
    }

    try {
      logger.debug('Removing %s from NPM team %s', npmHandle, team)
      await removeFromNpm(org, team, npmHandle)
      logger.info('Removed %s from NPM team %s', npmHandle, team)
    } catch (error) {
      logger.error('Failed to remove %s from NPM team %s', npmHandle, team)
      logger.error(error)
    }
  }
  logger.info('NPM offboarding completed for user %s ✅ ', npmHandle)
}
