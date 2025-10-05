/**
 * Finds inactive members in an organization for the given number of months
 * and opens an issue in the repository to propose moving them to the emeritus team.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, monthsInactiveThreshold: number, dryRun: boolean }} options
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

  const leadTeam = orgTeams.find(team => team.slug === 'leads')
  const usersThatShouldBeEmeritus = membersContributions
    .filter(isEmeritus(monthsInactiveThreshold))
    .filter(isNotLead(leadTeam))
  logger.info('Total emeritus members found: %s', usersThatShouldBeEmeritus.length)

  const emeritusTeam = orgTeams.find(team => team.slug === 'emeritus')
  const currentEmeritusUsers = emeritusTeam.members.map(member => member.login)

  const usersToEmeritus = usersThatShouldBeEmeritus.filter(user => currentEmeritusUsers.includes(user.user) === false)
  logger.debug('Total users to move to emeritus team: %s', usersToEmeritus.length)

  if (dryRun) {
    logger.info('[DRY-RUN] These users should be added to emeritus team:')
    usersToEmeritus.forEach(user => logger.info(`- @${user.user}`))
  } else {
    await client.createIssue(
      orgData.name,
      'org-admin',
      'Move to emeritus members',
      `The following users have been inactive for more than ${monthsInactiveThreshold} months
        and should be added to the emeritus team to control the access to the Fastify organization:

        ${usersToEmeritus.map(user => `- @${user.user}`).join('\n')}

        \nComment here if you don't want to move them to emeritus team.`,
      ['question']
    )
  }
}

function isNotLead (leadTeam) {
  const leads = leadTeam.members.map(member => member.login)
  return member => !leads.includes(member.user)
}

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
