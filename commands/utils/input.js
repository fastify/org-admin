import readline from 'node:readline/promises'

export async function confirm (q) {
  const answer = await askForInput(`${q} (y/N)`)
  return answer.trim().toLowerCase() === 'y'
}

export async function askForInput (message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const answer = await rl.question(message)
  rl.close()
  return answer.trim()
}
