import { env } from 'node:process'
import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

export default class AdminClient {
  /** @param {import('pino').Logger} [logger] - Optional logger instance, defaults to console. */
  constructor (logger) {
    if (!env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is not set')
    }

    this.logger = logger || console
    this.restClient = new Octokit({
      auth: env.GITHUB_TOKEN,
      userAgent: 'fastify-org-admin-cli',
    })

    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${env.GITHUB_TOKEN}`,
      },
    })
  }

  /**
   * Retrieves organization data for a given GitHub organization.
   * @param {string} orgName - The name of the GitHub organization.
   * @returns {Promise<object>} The organization data.
   */
  async getOrgData (orgName) {
    const { organization } = await this.graphqlClient(`
      query ($orgName: String!) {
        organization(login: $orgName) {
          id
          name
        }
      }
    `, { orgName })

    return organization
  }

  /**
   * Retrieves the organization chart for a given GitHub organization.
   * Fetches all teams and their members using the GitHub GraphQL API, handling pagination.
   * @async
   * @param {object} orgData - The organization data.
   * @param {string} orgData.name - The login name of the GitHub organization.
   * @returns {Promise<Team[]>} Array of team objects with their members and details.
   */
  async getOrgChart (orgData) {
    let cursor = null
    let hasNextPage = true
    const teamsData = []

    const teamsQuery = `
      query ($cursor: String, $orgName: String!) {
        organization(login: $orgName) {
          teams(first: 100, after: $cursor) {
            edges {
              node {
                id
                name
                slug
                description
                privacy
                members(first: 100) {
                  edges {
                    node {
                      login
                      name
                      email
                    }
                    role
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `

    while (hasNextPage) {
      const variables = { cursor, orgName: orgData.name }
      const teamsResponse = await this.graphqlClient(teamsQuery, variables)

      const teams = teamsResponse.organization.teams.edges
      teamsData.push(...teams.map(transformGqlTeam))

      cursor = teamsResponse.organization.teams.pageInfo.endCursor
      hasNextPage = teamsResponse.organization.teams.pageInfo.hasNextPage
    }

    return teamsData
  }

  /**
   * Fetches the contributions of a list of users within a specified organization over a defined number of years.
   * @param {object} orgData - Organization data.
   * @param {string[]} userList - List of GitHub usernames to fetch contributions for.
   * @param {number} yearsBack - Number of years to look back for contributions. Defaults to `1`.
   * @returns {Promise<SimplifiedMember[]>} Array of user contribution data.
   */
  async getUsersContributions (orgData, userList, yearsBack = 1) {
    const oldContributionsQuery = `
      query ($userId: String!, $orgId: ID, $from: DateTime!, $to: DateTime!) {
        user(login: $userId) {
          login
          name
          socialAccounts(last:4) {
            nodes {
              displayName
              url
              provider
            }
          }
          contributionsCollection(
            organizationID: $orgId
            from: $from
            to: $to
          ) {
            pullRequestContributions(last: 1, orderBy: {direction: ASC}) {
              nodes {
                occurredAt
                pullRequest {
                  url
                }
              }
            }
            issueContributions(last: 1, orderBy: {direction: ASC}) {
              nodes {
                occurredAt
                issue {
                  url
                }
              }
            }
            commitContributionsByRepository(maxRepositories: 1) {
              contributions(last: 1, orderBy: {direction: ASC, field: OCCURRED_AT}) {
                nodes {
                  repository {
                    name
                  }
                  occurredAt
                  url
                }
              }
            }
          }
        }
      }
    `

    const membersData = []
    for (const targetUser of userList) {
      let hasContributions = false
      for (let yearWindow = 0; yearWindow < yearsBack; yearWindow++) {
        const toDate = new Date()
        toDate.setFullYear(toDate.getFullYear() - yearWindow)

        // Always 1 year back because it is the max date range supported by the GQL Service
        const fromDate = new Date()
        fromDate.setFullYear(toDate.getFullYear() - 1)

        const variables = {
          userId: targetUser,
          orgId: orgData.id,
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        }

        this.logger.debug('Fetching contributions for user: %s from %s to %s', targetUser, variables.from, variables.to)
        const contributionsResponse = await this.graphqlClient(oldContributionsQuery, variables)
        const simplifiedUser = transformGqlMember({ node: contributionsResponse.user })

        // If the user has any contribution in the year window, add it to the list and avoid querying again
        // We are interested in at least one contribution in the year window
        if (simplifiedUser.lastPR || simplifiedUser.lastIssue || simplifiedUser.lastCommit) {
          hasContributions = true
          membersData.push(simplifiedUser)
          break
        }
      }

      if (!hasContributions) {
        this.logger.warn('No contributions found for user %s in the last %s years', targetUser, yearsBack)
        membersData.push({
          user: targetUser,
          lastPR: null,
          lastIssue: null,
          lastCommit: null,
        })
      }
    }

    return membersData
  }

  /**
   * Fetches all GitHub Sponsors of an organization using the GraphQL API, handling pagination.
   * Public sponsors are always returned; private sponsors are included only when the
   * authenticated token belongs to the organization.
   * @param {string} orgName - The login name of the GitHub organization.
   * @returns {Promise<Sponsor[]>} Array of normalized sponsor objects.
   */
  async getGithubSponsors (orgName) {
    let cursor = null
    let hasNextPage = true
    const sponsorsData = []

    // activeOnly: false also returns ended sponsorships, so a recurring sponsor
    // that cancelled (isActive: false) can be flagged as lapsed. GitHub does not
    // expose individual charges, so there is no per-payment date to read.
    const sponsorsQuery = `
      query ($orgName: String!, $cursor: String) {
        organization(login: $orgName) {
          sponsorshipsAsMaintainer(first: 100, after: $cursor, includePrivate: true, activeOnly: false) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              createdAt
              tierSelectedAt
              isActive
              privacyLevel
              isOneTimePayment
              tier {
                name
                monthlyPriceInDollars
                isOneTime
              }
              sponsorEntity {
                __typename
                ... on User {
                  login
                  name
                  url
                }
                ... on Organization {
                  login
                  name
                  url
                }
              }
            }
          }
        }
      }
    `

    while (hasNextPage) {
      const variables = { orgName, cursor }
      const response = await this.graphqlClient(sponsorsQuery, variables)

      const { nodes, pageInfo } = response.organization.sponsorshipsAsMaintainer
      sponsorsData.push(...nodes.map(transformGqlSponsor))

      cursor = pageInfo.endCursor
      hasNextPage = pageInfo.hasNextPage
    }

    return sponsorsData
  }

  /**
   * Fetches all Open Collective backers of a collective using the public GraphQL v2 API.
   * Reading backers is public and needs no authentication; if `OC_PERSONAL_TOKEN` is set
   * it is sent to raise rate limits. Drives off incoming orders (the source of payment
   * truth) so recurring contributions that lapsed can be flagged.
   * @param {string} slug - The Open Collective collective slug (e.g. 'fastify').
   * @returns {Promise<Sponsor[]>} Array of normalized sponsor objects, one per backer.
   */
  async getOpenCollectiveSponsors (slug) {
    const ordersQuery = `
      query ($slug: String!, $limit: Int!, $offset: Int!) {
        account(slug: $slug) {
          orders(filter: INCOMING, limit: $limit, offset: $offset) {
            totalCount
            nodes {
              id
              status
              frequency
              lastChargedAt
              nextChargeDate
              createdAt
              amount { value currency }
              tier { name }
              fromAccount { name slug type imageUrl website }
            }
          }
        }
      }
    `

    const limit = 100
    let offset = 0
    let totalCount = Infinity
    const orders = []

    while (offset < totalCount) {
      const variables = { slug, limit, offset }
      const response = await this.#openCollectiveRequest(ordersQuery, variables)

      const ordersPage = response.account?.orders
      if (!ordersPage) {
        throw new Error(`Open Collective collective not found: ${slug}`)
      }

      totalCount = ordersPage.totalCount
      orders.push(...ordersPage.nodes)
      offset += limit
    }

    // A backer can have several orders over time (e.g. a cancelled monthly plus a
    // later one-off). Collapse to one representative order per backer so the lapsed
    // flag reflects their current standing: prefer a recurring order, newest first.
    const now = new Date()
    const byBacker = new Map()
    for (const order of orders) {
      const key = order.fromAccount?.slug ?? order.id
      const current = byBacker.get(key)
      if (!current || isMoreRepresentativeOrder(order, current)) {
        byBacker.set(key, order)
      }
    }

    return [...byBacker.values()].map((order) => transformOcOrder(order, now))
  }

  /**
   * Sends a GraphQL request to the Open Collective v2 API.
   * @param {string} query - The GraphQL query string.
   * @param {object} variables - The query variables.
   * @returns {Promise<object>} The `data` payload of the response.
   */
  async #openCollectiveRequest (query, variables) {
    const headers = { 'Content-Type': 'application/json' }
    if (env.OC_PERSONAL_TOKEN) {
      headers['Personal-Token'] = env.OC_PERSONAL_TOKEN
    }

    const response = await fetch('https://api.opencollective.com/graphql/v2', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      throw new Error(`Open Collective API request failed: ${response.status} ${response.statusText}`)
    }

    const payload = await response.json()
    if (payload.errors) {
      throw new Error(`Open Collective API error: ${payload.errors.map((e) => e.message).join('; ')}`)
    }

    return payload.data
  }

  /**
   * Fetches user information from GitHub using the GraphQL API.
   * @param {string} username - The GitHub username.
   * @returns {Promise<any>} The user information.
   */
  async getUserInfo (username) {
    try {
      const variables = { username }
      const userQuery = `
        query ($username: String!) {
          user(login: $username) {
            login
            name
            socialAccounts(last:4) {
              nodes {
                displayName
                url
                provider
              }
            }
          }
      }
      `
      const response = await this.graphqlClient(userQuery, variables)
      return response.user
    } catch (error) {
      this.logger.error({ username, error }, 'Failed to fetch user info')
      throw error
    }
  }

  /**
   * Add a user to a team in the organization using the REST API.
   * @param {string} org - The organization name.
   * @param {string} teamSlug - The team slug.
   * @param {string} username - The GitHub username to add.
   * @returns {Promise<import('@octokit/openapi-types').components['schemas']['team-membership']>} The updated team data.
   */
  async addUserToTeam (org, teamSlug, username) {
    try {
      const response = await this.restClient.teams.addOrUpdateMembershipForUserInOrg({
        org,
        team_slug: teamSlug,
        username,
        role: 'member',
      })
      return response.data
    } catch (error) {
      this.logger.error({ username, teamSlug, error }, 'Failed to add user to team')
      throw error
    }
  }

  /**
   * Removes a user from a team in the organization using the REST API.
   * @param {string} org - The organization name.
   * @param {string} teamSlug - The team slug.
   * @param {string} username - The GitHub username to remove.
   * @returns {Promise<any>} The response data from the API.
   */
  async removeUserFromTeam (org, teamSlug, username) {
    try {
      const response = await this.restClient.teams.removeMembershipForUserInOrg({
        org,
        team_slug: teamSlug,
        username
      })
      this.logger.info({ username, teamSlug }, 'User removed from team')
      return response.data
    } catch (error) {
      this.logger.error({ username, teamSlug, error }, 'Failed to remove user from team')
      throw error
    }
  }

  /**
   * Creates a new issue in a repository using the REST API.
   * @param {string} owner - The repository owner (org or user).
   * @param {string} repo - The repository name.
   * @param {string} title - The issue title.
   * @param {string} body - The issue body/description.
   * @param {string[]} [labels] - Optional array of labels.
   * @returns {Promise<import('@octokit/openapi-types').components['schemas']['issue']>} The created issue data.
   */
  async createIssue (owner, repo, title, body, labels = []) {
    try {
      const response = await this.restClient.issues.create({
        owner,
        repo,
        title,
        body,
        labels
      })
      this.logger.info({ owner, repo, title }, 'Issue created via REST API')
      return response.data
    } catch (error) {
      this.logger.error({ owner, repo, title, error }, 'Failed to create issue via REST API')
      throw error
    }
  }
}

/**
 * Transforms a GitHub GraphQL team node into a simplified team object.
 * @param {object} gqlTeam - The GitHub GraphQL team node.
 * @param {object} gqlTeam.node - The team node.
 * @returns {Team} The simplified team object.
 */
function transformGqlTeam ({ node }) {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    description: node.description,
    privacy: node.privacy,
    members: node.members.edges.map(({ node: member, role }) => ({
      login: member.login,
      name: member.name,
      email: member.email,
      role
    }))
  }
}

/**
 * Transforms a GitHub GraphQL member node into a simplified member object.
 * @param {object} gqlMember - The GitHub GraphQL member node.
 * @param {object} gqlMember.node - The member node.
 * @returns {SimplifiedMember} The simplified member object.
 */
function transformGqlMember ({ node }) {
  return {
    user: node.login,
    lastPR: toDate(node.contributionsCollection.pullRequestContributions?.nodes[0]?.occurredAt),
    lastIssue: toDate(node.contributionsCollection.issueContributions?.nodes[0]?.occurredAt),
    lastCommit: toDate(node.contributionsCollection.commitContributionsByRepository?.[0]?.contributions?.nodes?.[0]?.occurredAt),
    socialAccounts: node.socialAccounts?.nodes,
  }
}

/**
 * Transforms a GitHub GraphQL sponsorship node into a normalized sponsor object.
 * A recurring sponsorship that is no longer active is flagged as lapsed; completed
 * one-time payments are never lapsed. GitHub exposes no per-charge date, so
 * `lastChargedAt`/`nextChargeDate` are always null for this source.
 * @param {object} sponsorship - The GitHub GraphQL sponsorship node.
 * @returns {Sponsor} The normalized sponsor object.
 */
function transformGqlSponsor (sponsorship) {
  const entity = sponsorship.sponsorEntity ?? {}
  const isOneTime = sponsorship.isOneTimePayment ?? sponsorship.tier?.isOneTime ?? false
  const isActive = sponsorship.isActive ?? true
  return {
    source: 'github',
    login: entity.login ?? null,
    name: entity.name ?? null,
    url: entity.url ?? null,
    type: entity.__typename ?? null,
    tier: sponsorship.tier?.name ?? null,
    amount: sponsorship.tier?.monthlyPriceInDollars ?? null,
    currency: 'USD',
    frequency: isOneTime ? 'ONETIME' : 'MONTHLY',
    isOneTime,
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    lastChargedAt: null,
    nextChargeDate: null,
    createdAt: sponsorship.createdAt ?? null,
    privacyLevel: sponsorship.privacyLevel ?? null,
    lapsed: !isOneTime && !isActive,
  }
}

/**
 * Determines whether an Open Collective order better represents a backer's current
 * standing than the one already kept. Recurring orders win over one-time ones;
 * among equals, the most recently created wins.
 * @param {object} candidate - The order being considered.
 * @param {object} current - The order currently kept for this backer.
 * @returns {boolean} True if `candidate` should replace `current`.
 */
function isMoreRepresentativeOrder (candidate, current) {
  const recurring = (order) => order.frequency === 'MONTHLY' || order.frequency === 'YEARLY'
  if (recurring(candidate) !== recurring(current)) {
    return recurring(candidate)
  }
  return new Date(candidate.createdAt) > new Date(current.createdAt)
}

/**
 * Transforms an Open Collective order node into a normalized sponsor object.
 * A recurring order is flagged as lapsed when it is no longer ACTIVE or its next
 * charge is already overdue. One-time contributions are never lapsed.
 * @param {object} order - The Open Collective order node.
 * @param {Date} now - The reference time used to detect overdue charges.
 * @returns {Sponsor} The normalized sponsor object.
 */
function transformOcOrder (order, now) {
  const entity = order.fromAccount ?? {}
  const isRecurring = order.frequency === 'MONTHLY' || order.frequency === 'YEARLY'
  const isOverdue = order.nextChargeDate ? new Date(order.nextChargeDate) < now : false
  return {
    source: 'opencollective',
    login: entity.slug ?? null,
    name: entity.name ?? null,
    url: entity.website ?? (entity.slug ? `https://opencollective.com/${entity.slug}` : null),
    type: entity.type ?? null,
    tier: order.tier?.name ?? null,
    amount: order.amount?.value ?? null,
    currency: order.amount?.currency ?? null,
    frequency: order.frequency ?? null,
    isOneTime: order.frequency === 'ONETIME',
    status: order.status ?? null,
    lastChargedAt: order.lastChargedAt ?? null,
    nextChargeDate: order.nextChargeDate ?? null,
    createdAt: order.createdAt ?? null,
    privacyLevel: null,
    lapsed: isRecurring && (order.status !== 'ACTIVE' || isOverdue),
  }
}

/**
 * Converts a date string to a Date object, or returns null if the string is falsy.
 * @param {string} dateStr - The date string to convert.
 * @returns {Date|null} The Date object or null.
 */
function toDate (dateStr) {
  return dateStr ? new Date(dateStr) : null
}

/**
 * @typedef {object} Team
 * @property {string} id - The team's unique identifier.
 * @property {string} name - The team's name.
 * @property {string} slug - The team's slug.
 * @property {string} [description] - The team's description.
 * @property {string} privacy - The team's privacy setting.
 * @property {TeamMember[]} members - The list of team members.
 */

/**
 * @typedef {object} TeamMember
 * @property {string} login - The member's GitHub login.
 * @property {string} [name] - The member's name.
 * @property {string} [email] - The member's email.
 * @property {string} role - The member's role in the team.
 */

/**
 * @typedef {object} SimplifiedMember
 * @property {string} user - The user's GitHub login.
 * @property {Date|null} lastPR - The date of the user's last pull request contribution.
 * @property {Date|null} lastIssue - The date of the user's last issue contribution.
 * @property {Date|null} lastCommit - The date of the user's last commit contribution.
 * @property {object[]} [socialAccounts] - The user's social accounts.
 */

/**
 * @typedef {object} Sponsor
 * @property {string} source - The funding platform ('github' or 'opencollective').
 * @property {string|null} login - The sponsor's login/handle/slug.
 * @property {string|null} name - The sponsor's display name.
 * @property {string|null} url - The sponsor's profile or website URL.
 * @property {string|null} type - The sponsor entity type ('User'/'Organization' or 'INDIVIDUAL'/'ORGANIZATION').
 * @property {string|null} tier - The sponsorship/contribution tier name.
 * @property {number|null} amount - The contribution amount in `currency` (monthly price for recurring GitHub tiers).
 * @property {string|null} currency - The contribution currency (e.g. 'USD').
 * @property {string|null} frequency - The contribution cadence ('ONETIME', 'MONTHLY' or 'YEARLY').
 * @property {boolean} isOneTime - Whether the contribution is a one-time payment.
 * @property {string|null} status - The platform-native status (GitHub 'ACTIVE'/'INACTIVE', Open Collective order status).
 * @property {string|null} lastChargedAt - When the recurring contribution last charged (Open Collective only; null for GitHub).
 * @property {string|null} nextChargeDate - When the recurring contribution is next due (Open Collective only; null for GitHub).
 * @property {string|null} createdAt - When the sponsorship/contribution started (ISO date string).
 * @property {string|null} privacyLevel - The GitHub sponsorship privacy level ('PUBLIC'/'PRIVATE'); null for Open Collective.
 * @property {boolean} lapsed - Whether a recurring sponsor stopped paying (cancelled/overdue); always false for one-time.
 */
