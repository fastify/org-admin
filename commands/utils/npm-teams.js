import { execFileSync } from 'node:child_process'

/**
 * Runs an npm CLI command with `--json` and parses its stdout. npm authentication
 * is taken from the environment (`.npmrc` / `NPM_CONFIG_TOKEN`).
 * @param {string[]} args - The npm arguments (without `--json`).
 * @returns {any} The parsed JSON output.
 */
function npmJson (args) {
  const stdout = execFileSync('npm', [...args, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(stdout)
}

/**
 * Lists the slugs of every team that actually exists in the npm organization.
 * @param {string} org - The npm organization name.
 * @returns {string[]} The team slugs (without the `org:` prefix).
 */
export function listNpmTeams (org) {
  return npmJson(['team', 'ls', org]).map((team) => team.replace(`${org}:`, ''))
}

/**
 * Lists the npm handles that belong to a given npm team.
 * @param {string} org - The npm organization name.
 * @param {string} team - The team slug.
 * @returns {string[]} The member handles.
 */
export function listNpmTeamMembers (org, team) {
  return npmJson(['team', 'ls', `${org}:${team}`])
}
