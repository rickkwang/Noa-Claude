import { describe, expect, test } from 'bun:test'
import { redactSecrets } from '../../bridge/debugUtils.js'

describe('redactSecrets', () => {
  test('redacts quoted secret values', () => {
    const out = redactSecrets(
      '{"access_token":"abcdefghijklmnopqrstuvwxyz","token":"short"}',
    )
    expect(out).toBe('{"access_token":"abcdefgh...wxyz","token":"[REDACTED]"}')
  })

  test('redacts unquoted key/value forms', () => {
    const out = redactSecrets('token=abcdefghijklmnopqrstuvwxyz')
    expect(out).toBe('token=abcdefgh...wxyz')
  })

  test('redacts scheme-prefixed credentials', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const out = redactSecrets(`Authorization: Bearer ${jwt}`)
    expect(out).not.toContain(jwt)
    expect(out.startsWith('Authorization: Bearer ')).toBe(true)
  })

  test('redacts well-known credential families', () => {
    const cases = [
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGH',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
      'glpat-abcdefghijklmnopqrst',
      ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
      'AKIAIOSFODNN7EXAMPLE',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    ]
    for (const token of cases) {
      const out = redactSecrets(`value: ${token}`)
      expect(out).not.toContain(token)
    }
  })

  test('leaves plain text alone', () => {
    const text = 'hello world, nothing sensitive in this line'
    expect(redactSecrets(text)).toBe(text)
  })
})
