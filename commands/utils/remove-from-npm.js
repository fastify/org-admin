import { spawn } from 'node:child_process'
import { askForInput } from './input.js'

function runSpawn (cmd, args) {
  return new Promise((resolve, reject) => {
    const cli = spawn(cmd, args, { env: process.env })
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
