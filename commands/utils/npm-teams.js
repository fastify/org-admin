import { npmJson } from './npm-json.js'

/**
 * Lists the slugs of every team that actually exists in the npm organization.
 * @param {string} org - The npm organization name.
 * @returns {string[]} The team slugs (without the `org:` prefix).
 */
export function listNpmTeams (org) {
  return npmJson(['team', 'ls', `@${org}`]).map((team) => team.replace(`${org}:`, ''))
}

/**
 * Lists the npm handles that belong to a given npm team.
 * @param {string} org - The npm organization name.
 * @param {string} team - The team slug.
 * @returns {string[]} The member handles.
 */
export function listNpmTeamMembers (org, team) {
  return npmJson(['team', 'ls', `@${org}:${team}`])
}
