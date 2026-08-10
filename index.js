#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { writeFileSync } from 'node:fs'
import pino from 'pino'

import AdminClient from './github-api.js'
import onboard from './commands/onboard.js'
import offboard from './commands/offboard.js'
import emeritus from './commands/emeritus.js'
import sponsors from './commands/sponsors.js'
import syncNpmOrg from './commands/sync-npm-org.js'
import { OrgAdminError } from './commands/utils/errors.js'

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
})

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

async function run () {
  if (!options.commands.includes(command)) {
    logger.error(`Unknown command: ${command}`)
    return 1
  }

  const client = new AdminClient(logger)
  const technicalOptions = { client, logger }

  switch (command) {
    case 'onboard':
    case 'offboard': {
      const username = parsed.values.username
      if (!username) {
        logger.error('Missing required username argument')
        return 1
      }

      if (command === 'onboard') {
        if (!parsed.values.team) {
          logger.error('Missing required team argument for onboarding')
          return 1
        }

        const joiningTeams = new Set(parsed.values.team)
        await onboard(technicalOptions, { username, dryRun, org, joiningTeams })
      } else {
        await offboard(technicalOptions, { username, dryRun, org })
      }
      break
    }
    case 'emeritus':
      await emeritus(technicalOptions, { dryRun, org, monthsInactiveThreshold })
      break
    case 'sponsors': {
      const result = await sponsors(technicalOptions, { org })
      writeFileSync('./sponsors.json', JSON.stringify(result, null, 2))
      logger.info('Sponsors written to ./sponsors.json')
      break
    }
    case 'sync-npm-org':
      await syncNpmOrg(technicalOptions, { org })
      break
  }
  return 0
}

run()
  .then((code) => { process.exit(code) })
  .catch((error) => {
    if (error instanceof OrgAdminError) {
      logger.error(error.message)
      process.exit(2)
    }
    logger.error(error)
    process.exit(1)
  })
