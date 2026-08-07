/**
 * Keyword a member must include in their comment to confirm their account is still
 * monitored and secured. Matched case-insensitively against comment bodies.
 */
const CONFIRMATION_KEYWORD = '/confirm-active'

/**
 * Finds inactive members in an organization for the given number of months
 * and opens an issue in the repository to propose moving them to the emeritus team.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string, monthsInactiveThreshold: number, dryRun: boolean }} options - Command options.
 * @returns {Promise<void>}
 */
export default async function emeritus ({ client, logger }, { org, monthsInactiveThreshold, dryRun }) {
  logger.info('Running emeritus command for organization: %s', org)

  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)

  const orgTeams = await client.getOrgChart(orgData)
  logger.info('Total teams: %s', orgTeams.length)

  // This maps holds the teams each member belongs to
  const membersOverview = new Map()
  for (const team of orgTeams) {
    for (const member of team.members) {
      if (membersOverview.has(member.login) === false) {
        membersOverview.set(member.login, [team])
      } else {
        membersOverview.get(member.login).push(team)
      }
    }
  }

  const membersList = Array.from(membersOverview.keys())
  logger.info('Total members: %s', membersList.length)

  const yearsToRead = Math.ceil(monthsInactiveThreshold / 12)
  const membersContributions = await client.getUsersContributions(orgData, membersList, yearsToRead)

  // Members who commented a confirmation on a previous emeritus issue within the same
  // inactivity window are considered "alive": they proved their account is still
  // monitored and secured, so they must not be pinged again until the window elapses.
  const confirmationSince = new Date()
  confirmationSince.setMonth(confirmationSince.getMonth() - monthsInactiveThreshold)
  const owner = orgData.name.toLowerCase()
  const repo = 'org-admin'
  const confirmedUsers = await client.getEmeritusConfirmations(owner, repo, confirmationSince, CONFIRMATION_KEYWORD)
  logger.info('Total members that recently confirmed they are active: %s', confirmedUsers.size)

  const leadTeam = orgTeams.find(team => team.slug === 'leads')
  const usersThatShouldBeEmeritus = membersContributions
    .filter(isEmeritus(monthsInactiveThreshold))
    .filter(isNotLead(leadTeam))
    .filter(isNotRecentlyConfirmed(confirmedUsers, logger))
  logger.info('Total emeritus members found: %s', usersThatShouldBeEmeritus.length)

  const emeritusTeam = orgTeams.find(team => team.slug === 'emeritus')
  const currentEmeritusUsers = emeritusTeam.members.map(member => member.login)

  const usersToEmeritus = usersThatShouldBeEmeritus.filter(user => currentEmeritusUsers.includes(user.user) === false)
  logger.debug('Total users to move to emeritus team: %s', usersToEmeritus.length)

  if (dryRun) {
    logger.info('[DRY-RUN] These users should be added to emeritus team:')
    usersToEmeritus.forEach(user => { logger.info(`- @${user.user}`) })
  } else {
    if (usersToEmeritus.length > 0) {
      await client.createIssue(
        owner,
        repo,
        'Move to emeritus members',
      `The following users have been inactive for more than ${monthsInactiveThreshold} months
        and should be added to the emeritus team to control the access to the Fastify organization
        and secure the organization's repositories:

${usersToEmeritus.map(user => `- @${user.user}`).join('\n')}

        \nIf you don't want to be moved to the emeritus team, comment here with \`${CONFIRMATION_KEYWORD}\`
        to confirm that your account is still monitored and secured. This confirmation is valid for
        ${monthsInactiveThreshold} months, after which you'll be asked to confirm again — you never need
        to open a pull request.`,
      ['question', 'emeritus-check']
      )
    }
  }
}

/**
 * Returns a filter function that checks if a member is not part of the lead team.
 * @param {import('../github-api.js').Team} leadTeam - The lead team.
 * @returns {(member: { user: string }) => boolean} Filter function.
 */
function isNotLead (leadTeam) {
  const leads = leadTeam.members.map(member => member.login)
  return member => !leads.includes(member.user)
}

/**
 * Returns a filter function that excludes members who recently confirmed they are active
 * by commenting on a previous emeritus issue, logging each one that is skipped.
 * @param {Set<string>} confirmedUsers - Set of lowercased logins that recently confirmed.
 * @param {import('pino').Logger} logger - Logger used to report skipped members.
 * @returns {(member: { user: string }) => boolean} Filter function.
 */
function isNotRecentlyConfirmed (confirmedUsers, logger) {
  return member => {
    if (confirmedUsers.has(member.user.toLowerCase())) {
      logger.info('Skipping @%s: recently confirmed their account is active', member.user)
      return false
    }
    return true
  }
}

/**
 * Returns a filter function that checks if a member has been inactive for the specified number of months.
 * @param {number} monthsInactiveThreshold - The number of months of inactivity to consider a member emeritus.
 * @returns {(member: { lastPR: Date | null, lastIssue: Date | null, lastCommit: Date | null }) => boolean} Filter function.
 */
function isEmeritus (monthsInactiveThreshold) {
  const now = new Date()
  return function filter (member) {
    const dates = [member.lastPR, member.lastIssue, member.lastCommit].filter(Boolean)
    // If any contribution is within the threshold, user should NOT be emeritus
    return !dates.some(date => {
      const monthsDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth())
      return monthsDiff <= monthsInactiveThreshold
    })
  }
}
