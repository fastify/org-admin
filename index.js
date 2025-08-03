#!/usr/bin/env node

import { parseArgs } from 'node:util'
import pino from 'pino'

import AdminClient from './github-api.js'
import onboard from './commands/onboard.js'
import offboard from './commands/offboard.js'
import emeritus from './commands/emeritus.js'

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
  commands: ['onboard', 'offboard', 'emeritus'],
  options: {
    dryRun: { type: 'boolean', default: false },
    username: { type: 'string', multiple: false, default: undefined },
    org: { type: 'string', multiple: false, default: 'fastify' },
    monthsInactiveThreshold: { type: 'string', multiple: false, default: '12' },
  },
  allowPositionals: true,
}

const parsed = parseArgs(options)

const [command, ...positionals] = parsed.positionals || []
const dryRun = parsed.values['dry-run'] || false
const org = parsed.values.org
const monthsInactiveThreshold = parseInt(parsed.values.monthsInactiveThreshold, 10) || 12

if (!options.commands.includes(command)) {
  logger.error(`Unknown command: ${command}`)
  process.exit(1)
}

const client = new AdminClient(logger)
const technicalOptions = { client, logger }

switch (command) {
  case 'onboard':
  case 'offboard': {
    const username = positionals[0]
    if (!username) {
      logger.error('Missing required username argument')
      process.exit(1)
    }

    if (command === 'onboard') {
      await onboard(technicalOptions, { username, dryRun, org })
    } else {
      await offboard(technicalOptions, { username, dryRun, org })
    }
    break
  }
  case 'emeritus':
    await emeritus(technicalOptions, { dryRun, org, monthsInactiveThreshold })
    break
}
