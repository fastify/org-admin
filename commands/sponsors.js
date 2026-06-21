import { writeFileSync } from 'node:fs'

const OUTPUT_FILE = './sponsors.json'

/**
 * Fastify's sponsorship tiers, defined by their minimum monthly contribution in
 * dollars. A sponsor is assigned the highest tier whose threshold its monthly
 * contribution meets (amounts between tiers round down). Sponsors below tier 1
 * are not considered tier sponsors.
 */
const TIERS = [
  { level: 1, monthly: 5 },
  { level: 2, monthly: 50 },
  { level: 3, monthly: 100 },
  { level: 4, monthly: 300 },
]

/**
 * Fetches all sponsors of an organization from GitHub Sponsors and Open Collective,
 * keeps only the recurring tier sponsors (monthly contribution within a tier),
 * sorts them by monthly amount descending and flags those that stopped paying.
 * The result is logged and written to a JSON file for later inspection.
 * @param {{ client: import('../github-api.js').default, logger: import('pino').Logger }} deps - Dependencies.
 * @param {{ org: string }} options - Command options.
 * @returns {Promise<void>}
 */
export default async function sponsors ({ client, logger }, { org }) {
  logger.info('Running sponsors command for organization: %s', org)

  const githubSponsors = await client.getGithubSponsors(org)
  logger.info('Fetched %s GitHub sponsorships', githubSponsors.length)

  const openCollectiveSponsors = await client.getOpenCollectiveSponsors(org)
  logger.info('Fetched %s Open Collective backers', openCollectiveSponsors.length)

  // Keep only recurring contributions that reach at least tier 1, tag each with
  // its tier, and order the combined list by monthly contribution descending.
  const sponsorList = [...githubSponsors, ...openCollectiveSponsors]
    .filter((sponsor) => tierFor(sponsor.monthlyAmount) !== null)
    .map((sponsor) => ({ ...sponsor, tierLevel: tierFor(sponsor.monthlyAmount) }))
    .sort((a, b) => b.monthlyAmount - a.monthlyAmount)

  logger.info('Tier sponsors (%s), ordered by monthly amount:', sponsorList.length)
  for (const sponsor of sponsorList) {
    logger.info(
      '- tier %s · $%s/mo · %s [%s]%s',
      sponsor.tierLevel,
      sponsor.monthlyAmount,
      displayName(sponsor),
      sponsor.source,
      sponsor.lapsed ? ' · ⚠ lapsed' : ''
    )
  }

  const flagged = sponsorList.filter((sponsor) => sponsor.lapsed)
  if (flagged.length > 0) {
    logger.warn('%s lapsed tier sponsor(s) need attention:', flagged.length)
    for (const sponsor of flagged) {
      logger.warn(
        '  ⚠ tier %s · %s [%s] — last charged %s',
        sponsor.tierLevel,
        displayName(sponsor),
        sponsor.source,
        sponsor.lastChargedAt ?? 'unknown'
      )
    }
  }

  const result = {
    tiers: TIERS,
    sponsors: sponsorList,
    flagged,
  }

  writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2))
  logger.info('Sponsors written to %s', OUTPUT_FILE)
}

/**
 * Returns the tier level for a given normalized monthly contribution, or null when
 * the contribution is missing or below the lowest tier.
 * @param {number|null} monthlyAmount - The normalized monthly contribution in dollars.
 * @returns {number|null} The tier level (1-4) or null.
 */
function tierFor (monthlyAmount) {
  if (monthlyAmount === null || monthlyAmount < TIERS[0].monthly) {
    return null
  }
  let level = null
  for (const tier of TIERS) {
    if (monthlyAmount >= tier.monthly) {
      level = tier.level
    }
  }
  return level
}

/**
 * Builds a human-friendly label for a sponsor.
 * @param {import('../github-api.js').Sponsor} sponsor - The sponsor.
 * @returns {string} The display label.
 */
function displayName (sponsor) {
  return sponsor.name ? `${sponsor.login} (${sponsor.name})` : sponsor.login
}
