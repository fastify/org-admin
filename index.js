#!/usr/bin/env node

import { parseArgs } from 'node:util'
import pino from 'pino'

import AdminClient from './github-api.js'
import onboard from './commands/onboard.js'
import offboard from './commands/offboard.js'
import emeritus from './commands/emeritus.js'
import sponsors from './commands/sponsors.js'
import syncNpmOrg from './commands/sync-npm-org.js'

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
})

// Read the env vars this CLI consumes explicitly. Nothing below this file
// should touch `process.env` directly — values are passed down as named args.
const githubToken = process.env.GITHUB_TOKEN
const ocPersonalToken = process.env.OC_PERSONAL_TOKEN

if (!githubToken) {
  logger.error('GITHUB_TOKEN environment variable is not set')
  process.exit(1)
}

const options = {
  commands: ['onboard', 'offboard', 'emeritus', 'sponsors', 'sync-npm-org'],
  options: {
    dryRun: { type: 'boolean', default: false },
    username: { type: 'string', multiple: false, default: undefined },
    team: { type: 'string', multiple: true },
    org: { type: 'string', multiple: false, default: 'fastify' },
    monthsInactiveThreshold: { type: 'string', multiple: false, default: '12' },
  },
  allowPositionals: true,
}

const parsed = parseArgs(options)

// const [command, ...positionals] = parsed.positionals || []
const [command] = parsed.positionals || []
const dryRun = parsed.values.dryRun || false
const org = parsed.values.org
const monthsInactiveThreshold = parseInt(parsed.values.monthsInactiveThreshold, 10) || 12

if (!options.commands.includes(command)) {
  logger.error(`Unknown command: ${command}`)
  process.exit(1)
}

const client = new AdminClient({ githubToken, ocPersonalToken, logger })
const deps = { client, logger }

switch (command) {
  case 'onboard':
  case 'offboard': {
    const username = parsed.values.username
    if (!username) {
      logger.error('Missing required username argument')
      process.exit(1)
    }

    if (command === 'onboard') {
      if (!parsed.values.team) {
        logger.error('Missing required team argument for onboarding')
        process.exit(1)
      }

      const joiningTeams = new Set(parsed.values.team)
      await onboard(deps, { org, username, joiningTeams, dryRun })
    } else {
      await offboard(deps, { org, username, dryRun })
    }
    break
  }
  case 'emeritus':
    await emeritus(deps, { org, monthsInactiveThreshold, dryRun })
    break
  case 'sponsors':
    await sponsors(deps, { org })
    break
  case 'sync-npm-org':
    await syncNpmOrg(deps, { org })
    break
}
