import { OrgAdminError } from './utils/errors.js'
import { listNpmTeams as defaultListNpmTeams } from './utils/npm-teams.js'

/**
 * Onboards a user to an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger, listNpmTeams?: Function }} deps - Dependencies.
 * @param {{ org: string, username: string, joiningTeams: Set, dryRun: boolean }} options - Command options.
 * @returns {Promise<object>}
 */
export default async function onboard ({ client, logger, listNpmTeams = defaultListNpmTeams }, { org, username, joiningTeams, dryRun }) {
  const joiningUser = await client.getUserInfo(username)
  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)

  const orgTeams = await client.getOrgChart(orgData)
  const destinationTeams = orgTeams.filter(t => joiningTeams.has(t.slug))

  const teamSlugs = new Set(orgTeams.map(t => t.slug))
  const wrongInputTeams = joiningTeams.difference(teamSlugs)
  if (wrongInputTeams.size) {
    throw new OrgAdminError(
      'UNKNOWN_TEAM',
      `Team ${[...wrongInputTeams].join(', ')} not found in organization ${org}`
    )
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
  const npmCommands = listNpmTeams(org).map(team => `npm team add @${org}:${team} ${npmHandle}`)
  npmCommands.forEach(command => { logger.info(command) })
  logger.info('When it will be done, the NPM onboarding will be completed for user %s ✅ ', npmHandle)

  return {
    command: 'onboard',
    dryRun,
    organization: orgData.name || org,
    user: {
      login: joiningUser.login,
      name: joiningUser.name,
      npmHandle,
    },
    teams: destinationTeams.map(team => team.slug),
    npmCommands,
  }
}
