import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

export default class AdminClient {
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
