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

  const usersThatShouldBeEmeritus = membersContributions.filter(isEmeritus(monthsInactiveThreshold))
  logger.info('Total emeritus members found: %s', usersThatShouldBeEmeritus.length)

  const emeritusTeam = orgTeams.find(team => team.slug === 'emeritus')
  const currentEmeritusUsers = emeritusTeam.members.map(member => member.login)

  const usersToEmeritus = usersThatShouldBeEmeritus.filter(user => currentEmeritusUsers.includes(user.user) === false)

  if (dryRun) {
    logger.info('These users should be added to emeritus team:')
    usersToEmeritus.forEach(user => logger.info(`- ${user.user}`))
  } else {
    // Let's do it sequentially to avoid hitting API rate limits
    for (const staleUser of usersToEmeritus) {
      logger.info('Adding user %s to emeritus team', staleUser.user)
      await client.addUserToTeam(orgData.name, emeritusTeam.slug, staleUser.user)

      const userTeams = membersOverview.get(staleUser.user)
      await Promise.all(userTeams.map(team => {
        logger.debug('Removing user %s from team %s', staleUser.user, team.name)
        return client.removeUserFromTeam(orgData.name, team.slug, staleUser.user)
      }))
    }
  }
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
