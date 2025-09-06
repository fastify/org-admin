import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

export default class AdminClient {
  /** @param {import('pino').Logger} [logger] */
  constructor (logger) {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is not set')
    }

    this.logger = logger || console
    this.restClient = new Octokit({
      auth: process.env.GITHUB_TOKEN,
      userAgent: 'fastify-org-admin-cli',
    })

    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${process.env.GITHUB_TOKEN}`,
      },
    })
  }

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
   *
   * @param {Object} orgData
   * @param {string[]} userList
   * @param {number} yearsBack
   * @returns {Promise<Object[]>}
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
   * Add a user to a team in the organization using the REST API.
   * @param {string} org - The organization name.
   * @param {string} teamSlug - The team slug.
   * @param {string} username - The GitHub username to add.
   * @return {Promise<import('@octokit/openapi-types').components['schemas']['team-membership']>} The updated team data.
   */
  async addUserToTeam (org, teamSlug, username) {
    try {
      const response = await this.restClient.teams.addOrUpdateMembershipForUserInOrg({
        org,
        team_slug: teamSlug,
        username,
        role: 'member',
      })

      this.logger.info({ username, teamSlug }, 'User added to team')
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
   * @param {Array<string>} [labels] - Optional array of labels.
   * @return {Promise<import('@octokit/openapi-types').components['schemas']['issue']>} The created issue data.
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

function transformGqlMember ({ node }) {
  return {
    user: node.login,
    lastPR: toDate(node.contributionsCollection.pullRequestContributions?.nodes[0]?.occurredAt),
    lastIssue: toDate(node.contributionsCollection.issueContributions?.nodes[0]?.occurredAt),
    lastCommit: toDate(node.contributionsCollection.commitContributionsByRepository?.[0]?.contributions?.nodes?.[0]?.occurredAt),
    socialAccounts: node.socialAccounts?.nodes,
  }
}

function toDate (dateStr) {
  return dateStr ? new Date(dateStr) : null
}
