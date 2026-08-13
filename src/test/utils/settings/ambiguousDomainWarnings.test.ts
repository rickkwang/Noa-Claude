import { describe, expect, test } from 'bun:test'
import { collectAmbiguousDomainWarnings } from '../../../utils/settings/validation.js'

const FILE = '/tmp/settings.json'

describe('collectAmbiguousDomainWarnings', () => {
  test('leaves unambiguous domain spellings alone', () => {
    const data = {
      permissions: {
        allow: [
          'WebFetch(domain:example.com)',
          'WebFetch(domain:*.example.com)',
          'WebFetch(domain:example.com:443)',
          'WebFetch(domain:1.2.3.4:8080)',
          'WebFetch(domain:[::1]:443)',
          'WebFetch(domain:[2001:db8::1])',
          'Bash(ls:*)',
        ],
      },
      sandbox: {
        network: {
          allowedDomains: ['github.com', '*.npmjs.org', '[fd00:ec2::254]:80'],
        },
      },
    }

    expect(collectAmbiguousDomainWarnings(data, FILE)).toEqual([])
  })

  test('flags every unbracketed multi-colon entry, since the runtime rejects them all', () => {
    const data = {
      permissions: { allow: ['WebFetch(domain:fd00::dead)'] },
      sandbox: {
        network: { allowedDomains: ['2001:db8::a1b2', '::1:99999', '::1:0'] },
      },
    }

    expect(collectAmbiguousDomainWarnings(data, FILE)).toHaveLength(4)
  })

  test('flags unbracketed IPv6 literals in WebFetch rules', () => {
    const data = {
      permissions: {
        allow: ['WebFetch(domain:::1:443)'],
        deny: ['WebFetch(domain:fd00:ec2::254)'],
      },
    }

    const warnings = collectAmbiguousDomainWarnings(data, FILE)

    expect(warnings).toHaveLength(2)
    expect(warnings[0]?.path).toBe('permissions.allow')
    expect(warnings[0]?.invalidValue).toBe('::1:443')
    expect(warnings[1]?.path).toBe('permissions.deny')
    expect(warnings[1]?.invalidValue).toBe('fd00:ec2::254')
    expect(warnings[0]?.suggestion).toContain('[::1]')
  })

  test('flags unbracketed IPv6 literals in sandbox.network.allowedDomains', () => {
    const data = {
      sandbox: { network: { allowedDomains: ['2001:db8::1'] } },
    }

    const warnings = collectAmbiguousDomainWarnings(data, FILE)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.path).toBe('sandbox.network.allowedDomains')
    expect(warnings[0]?.file).toBe(FILE)
  })

  test('is diagnostic only and never mutates the settings data', () => {
    const data = {
      permissions: { deny: ['WebFetch(domain:fd00:ec2::254)'] },
      sandbox: { network: { allowedDomains: ['2001:db8::1'] } },
    }
    const snapshot = structuredClone(data)

    collectAmbiguousDomainWarnings(data, FILE)

    expect(data).toEqual(snapshot)
  })

  test('tolerates malformed input shapes', () => {
    expect(collectAmbiguousDomainWarnings(null, FILE)).toEqual([])
    expect(collectAmbiguousDomainWarnings('nope', FILE)).toEqual([])
    expect(collectAmbiguousDomainWarnings({}, FILE)).toEqual([])
    expect(
      collectAmbiguousDomainWarnings({ permissions: { allow: [42, null] } }, FILE),
    ).toEqual([])
    expect(
      collectAmbiguousDomainWarnings({ sandbox: { network: {} } }, FILE),
    ).toEqual([])
  })
})
