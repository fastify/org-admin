export default async function emeritus ({ client, logger }, { org, monthsInactiveThreshold, dryRun }) {
  logger.info('Running emeritus command for organization: %s', org)

  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)

  const orgTeams = await client.getOrgChart(orgData)
  logger.info('Total teams: %s', orgTeams.length)

  const membersDetails = await client.getMembersDetails(orgData)
  logger.info('Total members: %s', membersDetails.length)

  if (monthsInactiveThreshold > 12) {
    // Since `getMembersDetails` returns members active in the last 12 months,
    // we need to run another query to get members without contributions in the last year.
    const membersWithoutContribInLastYear = membersDetails.filter(item => !item.lastPR && !item.lastIssue && !item.lastCommit)

    const yearsToRead = Math.ceil(monthsInactiveThreshold / 12)
    logger.warn('The monthsInactiveThreshold is set to more than 12 months, reading contributions for %s years...', yearsToRead)
    const olderContributions = await client.getOlderContributions(orgData, membersWithoutContribInLastYear, yearsToRead)

    // ! TODO merge the results instead of appending
    membersDetails.push(...olderContributions)
  }

  const usersThatShouldBeEmeritus = membersDetails.filter(isEmeritus(monthsInactiveThreshold))
  logger.info('Total emeritus members found: %s', usersThatShouldBeEmeritus.length)

  const emeritusTeam = orgTeams.find(team => team.slug === 'emeritus')
  const currentEmeritusUsers = emeritusTeam.members.map(member => member.login)

  const usersToAdd = usersThatShouldBeEmeritus.filter(user => currentEmeritusUsers.includes(user.user) === false)

  if (dryRun) {
    logger.info('[DRY RUN] Would run emeritus command')
    console.log(usersToAdd)
  } else {
    // TODO Implement emeritus logic here
    //   logger.info('Running emeritus command')
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
