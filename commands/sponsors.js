import { writeFileSync } from 'node:fs'

const OUTPUT_FILE = './sponsors.json'

/**
 * Fetches and lists all sponsors of an organization from GitHub Sponsors and
 * Open Collective. Recurring sponsors that stopped paying are flagged as lapsed.
 * The result is logged and written to a JSON file for later inspection.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string }} options - Command options.
 * @returns {Promise<void>}
 */
export default async function sponsors ({ client, logger }, { org }) {
  logger.info('Running sponsors command for organization: %s', org)

  const githubSponsors = await client.getGithubSponsors(org)
  logger.info('Total GitHub sponsors: %s', githubSponsors.length)
  logSponsors(logger, githubSponsors)

  const openCollectiveSponsors = await client.getOpenCollectiveSponsors(org)
  logger.info('Total Open Collective backers: %s', openCollectiveSponsors.length)
  logSponsors(logger, openCollectiveSponsors)

  const flagged = [...githubSponsors, ...openCollectiveSponsors].filter((sponsor) => sponsor.lapsed)
  if (flagged.length > 0) {
    logger.warn('%s lapsed sponsor(s) need attention:', flagged.length)
    for (const sponsor of flagged) {
      logger.warn(
        '  ⚠ %s [%s] — %s, last charged %s',
        displayName(sponsor),
        sponsor.source,
        sponsor.tier ?? 'no tier',
        sponsor.lastChargedAt ?? 'unknown'
      )
    }
  }

  const result = {
    github: githubSponsors,
    openCollective: openCollectiveSponsors,
    flagged,
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2))
  logger.info('Sponsors written to %s', OUTPUT_FILE)
}

/**
 * Logs one line per sponsor, marking lapsed recurring sponsors.
 * @param {import('pino').Logger} logger - The logger instance.
 * @param {import('../github-api.js').Sponsor[]} sponsorList - The sponsors to log.
 * @returns {void}
 */
function logSponsors (logger, sponsorList) {
  for (const sponsor of sponsorList) {
    const mark = sponsor.lapsed ? '⚠ lapsed' : sponsor.tier ?? 'no tier'
    logger.info('- %s — %s', displayName(sponsor), mark)
  }
}

/**
 * Builds a human-friendly label for a sponsor.
 * @param {import('../github-api.js').Sponsor} sponsor - The sponsor.
 * @returns {string} The display label.
 */
function displayName (sponsor) {
  return sponsor.name ? `${sponsor.login} (${sponsor.name})` : sponsor.login
}
