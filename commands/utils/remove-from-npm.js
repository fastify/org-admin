import { env } from 'node:process'
import { spawn } from 'node:child_process'
import { askForInput } from './input.js'

/**
 * Runs a command using `child_process.spawn`, returning the stdout on success.
 * @param {string} cmd - The command to execute.
 * @param {string[]} args - Array of arguments to pass to the command.
 * @returns {Promise<string>} A promise that resolves with the trimmed stdout on success or rejects with an Error on failure.
 * @throws {Error} Throws an error if the command exits with a non-zero code, including stdout and stderr in the error message.
 */
function runSpawn (cmd, args) {
  return new Promise((resolve, reject) => {
    const cli = spawn(cmd, args, { env })
    cli.stdout.setEncoding('utf8')
    cli.stderr.setEncoding('utf8')

    let stdout = ''
    let stderr = ''
    cli.stdout.on('data', (data) => { stdout += data })
    cli.stderr.on('data', (data) => { stderr += data })
    cli.on('close', (code, signal) => {
      if (code === 0) {
        return resolve(stdout.trim())
      }
      reject(new Error(`${cmd} ${args} returned code ${code} and signal ${signal}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`))
    })
  })
}

/**
 * Removes a user from an NPM organization team, prompting for OTP if required.
 * @param {string} org - The NPM organization name.
 * @param {string} teamSlug - The team slug.
 * @param {string} username - The NPM username to remove from the team.
 * @returns {Promise<void>} A promise that resolves when the user is successfully removed.
 * @throws {Error} Throws an error if the npm command fails for reasons other than missing OTP.
 */
export async function removeFromNpm (org, teamSlug, username) {
  const baseArgs = ['team', 'rm', `@${org}:${teamSlug}`, username]

  try {
    await runSpawn('npm', baseArgs)
  } catch (error) {
    const isOtpNeeded = error.message.includes('npm ERR! code EOTP') || error.message.includes('one-time password')
    if (!isOtpNeeded) {
      throw error
    }

    const otp = await askForInput('NPM OTP code is required to proceed:')
    const otpArgs = [...baseArgs, '--otp', otp]
    await runSpawn('npm', otpArgs)
  }
}
