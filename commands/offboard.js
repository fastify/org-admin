import { removeFromNpm } from './utils/remove-from-npm.js'
import { listNpmTeams as defaultListNpmTeams, listNpmTeamMembers as defaultListNpmTeamMembers } from './utils/npm-teams.js'
/**
 * Offboards a user from an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger, listNpmTeams?: Function, listNpmTeamMembers?: Function }} deps - Dependencies.
 * @param {{ org: string, username: string, joiningTeams: Set, dryRun: boolean }} options - Command options.
 * @returns {Promise<object>}
 */
export default async function offboard ({
  logger,
  client,
  requestNpmOtp,
  removeFromNpm: removeNpm = removeFromNpm,
  listNpmTeams = defaultListNpmTeams,
  listNpmTeamMembers = defaultListNpmTeamMembers,
}, { org, username, dryRun }) {
  const joiningUser = await client.getUserInfo(username)
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

  const npmFailures = []
  for (const team of userNpmTeams) {
    if (dryRun) {
      logger.warn('[DRY RUN] This user %s will be removed from NPM team %s', npmHandle, team)
      continue
    }

    try {
      logger.debug('Removing %s from NPM team %s', npmHandle, team)
      await removeNpm(org, team, npmHandle, { requestOtp: requestNpmOtp })
      logger.info('Removed %s from NPM team %s', npmHandle, team)
    } catch (error) {
      if (error?.code === 'NPM_OTP_REQUIRED') {
        throw error
      }
      logger.error('Failed to remove %s from NPM team %s', npmHandle, team)
      logger.error(error)
      npmFailures.push({ team, error: error.message })
    }
  }
  logger.info('NPM offboarding completed for user %s ✅ ', npmHandle)

  return {
    command: 'offboard',
    dryRun,
    organization: orgData.name || org,
    user: {
      login: joiningUser.login,
      name: joiningUser.name,
      npmHandle,
    },
    githubTeams: userTeams.map(team => team.slug),
    emeritusTeamAdded: Boolean(emeritusTeam),
    npmTeams: userNpmTeams,
    npmFailures,
  }
}
