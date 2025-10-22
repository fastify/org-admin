import readline from 'node:readline/promises'

/**
 * Onboards a user to an organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, joiningTeams:Set, dryRun: boolean }} options
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
  const destinationTeams = orgTeams.filter(t => joiningTeams.has(t.slug))

  const teamSlugs = new Set(orgTeams.map(t => t.slug))
  const wrongInputTeams = joiningTeams.difference(teamSlugs)
  if (wrongInputTeams.size) {
    logger.error('Team %s not found in organization %s', [...wrongInputTeams], org)
    process.exit(1)
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
  // This step cannot be automated, there are no API to add members to an org on NPM
  logger.info('1. Invite the user to the organization on NPM: https://www.npmjs.com/org/%s/invite?track=existingOrgAddMembers', org)
  logger.info('2. Add the user to the relevant teams by using the commands:');
  [
    { slug: 'developers' }, // NPM has a default team for every org
    ...destinationTeams
  ].forEach(team => {
    logger.info('npm team add @%s:%s %s', org, team.slug, joiningUser.login)
  })
  logger.info('When it will be done, the NPM onboarding will be completed for user %s ✅ ', joiningUser.login)
}

async function confirm (q) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const answer = await rl.question(`${q} (y/N)`)
  rl.close()
  return answer.trim().toLowerCase() === 'y'
}
