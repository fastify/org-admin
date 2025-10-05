import readline from 'node:readline/promises'

/**
 * Onboards a user to an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, dryRun: boolean }} options
 * @returns {Promise<void>}
 */
export default async function onboard ({ client, logger }, { org, username, joiningTeams, dryRun }) {
  const joiningUser = await client.getUserInfo(username)
  if (!await confirm(`Are you sure you want to onboard ${joiningUser.login} [${joiningUser.name}] to ${org}?`)) {
    logger.warn('Aborting onboarding')
    process.exit(0)
  }

  const orgData = await client.getOrgData(org)
  logger.info('Organization ID %s', orgData.id)

  const orgTeams = await client.getOrgChart(orgData)
  const destinationTeams = orgTeams.filter(t => joiningTeams.includes(t.slug))
  if (destinationTeams.length !== joiningTeams.length) {
    const missing = joiningTeams.filter(t => destinationTeams.find(dt => dt.slug === t) == null)
    logger.error('Team %s not found in organization %s', missing, org)
    process.exit(1)
  }

  if (dryRun) {
    logger.info('[DRY-RUN] This user %s should be added to team %s', joiningUser.login, destinationTeams.map(t => t.slug))
  } else {
    for (const targetTeam of destinationTeams) {
      await client.addUserToTeam(org, targetTeam.slug, joiningUser.login)
      logger.info('Added %s to team %s', joiningUser.login, targetTeam.slug)
    }
  }
}

async function confirm (q) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const answer = await rl.question(`${q} (y/n)`)
  rl.close()
  return answer.trim().toLowerCase() === 'y'
}
