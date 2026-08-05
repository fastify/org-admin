import { execFileSync } from 'node:child_process'

/**
 * Runs an npm CLI command with `--json` and parses its stdout. npm authentication
 * is taken from the environment (`.npmrc` / `NPM_CONFIG_TOKEN`).
 * @param {string[]} args - The npm arguments (without `--json`).
 * @returns {any} The parsed JSON output.
 */
export function npmJson (args) {
  const stdout = execFileSync('npm', [...args, '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return JSON.parse(stdout)
}
