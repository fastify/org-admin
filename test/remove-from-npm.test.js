import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { removeFromNpm } from '../commands/utils/remove-from-npm.js'

describe('removeFromNpm', () => {
  it('requests and retries with an OTP when npm requires one', async (t) => {
    let attempt = 0
    const run = t.mock.fn(async () => {
      if (attempt++ === 0) throw new Error('npm ERR! code EOTP')
    })
    const requestOtp = t.mock.fn(async () => '123456')

    await removeFromNpm('fastify', 'plugins', 'alice', { run, requestOtp })

    assert.equal(run.mock.callCount(), 2)
    assert.deepEqual(run.mock.calls[1].arguments, [
      'npm',
      ['team', 'rm', '@fastify:plugins', 'alice', '--otp', '123456'],
    ])
  })

  it('throws a stable error when OTP cannot be requested', async () => {
    const run = async () => { throw new Error('one-time password required') }
    await assert.rejects(
      () => removeFromNpm('fastify', 'plugins', 'alice', { run }),
      { code: 'NPM_OTP_REQUIRED' }
    )
  })
})
