import { stdin, stdout } from 'node:process'
import readline from 'node:readline/promises'

/**
 * Asks the user for a yes/no confirmation.
 * @param {string} q - The question to ask.
 * @returns {Promise<boolean>} True if the user confirmed, false otherwise.
 */
export async function confirm (q) {
  const answer = await askForInput(`${q} (y/N)`)
  return answer.trim().toLowerCase() === 'y'
}

/**
 * Asks the user for input.
 * @param {string} message - The message to display to the user.
 * @returns {Promise<string>} The user's input.
 */
export async function askForInput (message) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  })
  const answer = await rl.question(message)
  rl.close()
  return answer.trim()
}
