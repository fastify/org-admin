/**
 * Onboards a user to the organization.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps
 * @param {{ org: string, username: string, dryRun: boolean }} options
 * @returns {Promise<void>}
 */
export default async function onboard ({ client, logger }, { org, username, dryRun }) {
  const orgId = await client.getOrgId(org)
  logger.info('Organization ID %s', orgId)

  const orgChart = await client.getOrgChart(org)

  // TODO Implement onboarding logic here
  if (dryRun) {
    logger.info(`[DRY RUN] Would onboard user: ${username}`)
  } else {
    logger.info(`Onboarding user: ${username}`)
  }
}
