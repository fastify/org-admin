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

  async getMembersDetails (orgData) {
    let cursor = null
    let hasNextPage = true
    const membersData = []

    const membersQuery = `
      query ($cursor: String, $orgName: String!, $orgId: ID, $fromDate: DateTime!, $toDate: DateTime!) {
        organization(login: $orgName) {
          membersWithRole(first: 15, after: $cursor) {
            edges {
              node {
                login
                name
                contributionsCollection(
                  organizationID: $orgId
                  from: $fromDate
                  to: $toDate
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
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `

    // Calculate MAX date range supported by the GQL Service (from 1 year ago to today)
    const toDate = new Date()
    const fromDate = new Date()
    fromDate.setFullYear(fromDate.getFullYear() - 1)

    while (hasNextPage) {
      const variables = {
        cursor,
        orgId: orgData.id,
        orgName: orgData.name,
        fromDate,
        toDate
      }

      const membersResponse = await this.graphqlClient(membersQuery, variables)

      const members = membersResponse.organization.membersWithRole.edges
      membersData.push(...members.map(transformGqlMember))

      cursor = membersResponse.organization.membersWithRole.pageInfo.endCursor
      hasNextPage = membersResponse.organization.membersWithRole.pageInfo.hasNextPage
    }

    return membersData
  }

  async getOlderContributions (orgData, userList, yearsBack = 1) {
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
    for (let yearWindow = 0; yearWindow < yearsBack; yearWindow++) {
      this.logger.debug('Fetching contributions for %s users in year window: %s', userList.length, yearWindow)

      for (const staleUser of userList) {
        const toDate = new Date()
        toDate.setFullYear(toDate.getFullYear() - yearWindow)

        const fromDate = new Date() // Always 1 year back
        fromDate.setFullYear(toDate.getFullYear() - 1)

        const variables = {
          userId: staleUser.user,
          orgId: orgData.id,
          from: fromDate.toISOString(),
          to: toDate.toISOString()
        }

        // TODO it is not neccessary to query again if the user has a contribution in the previous iteration
        // ! TODO merge the results instead of querying again

        this.logger.debug('Fetching contributions for user: %s from %s to %s', staleUser.user, variables.from, variables.to)
        const contributionsResponse = await this.graphqlClient(oldContributionsQuery, variables)
        membersData.push(transformGqlMember({ node: contributionsResponse.user }))
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
