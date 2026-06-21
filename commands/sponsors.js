import { writeFileSync } from 'node:fs'

const OUTPUT_FILE = './sponsors.json'

/**
 * Fetches and lists all sponsors of an organization.
 * Currently fetches GitHub Sponsors; Open Collective backers will be added later.
 * The result is logged and written to a JSON file for later inspection.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string }} options - Command options.
 * @returns {Promise<void>}
 */
export default async function sponsors ({ client, logger }, { org }) {
  logger.info('Running sponsors command for organization: %s', org)

  const githubSponsors = await client.getGithubSponsors(org)
  logger.info('Total GitHub sponsors: %s', githubSponsors.length)

  for (const sponsor of githubSponsors) {
    const displayName = sponsor.name ? `${sponsor.login} (${sponsor.name})` : sponsor.login
    logger.info('- @%s — %s', displayName, sponsor.tier ?? 'no tier')
  }

  const result = {
    github: githubSponsors,
    openCollective: [],
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2))
  logger.info('Sponsors written to %s', OUTPUT_FILE)
}
