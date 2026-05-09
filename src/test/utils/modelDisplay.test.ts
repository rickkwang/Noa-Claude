import { describe, expect, test } from 'bun:test'
import {
  getMarketingNameForModel,
  modelDisplayString,
  renderModelName,
} from '../../utils/model/model.js'

describe('Kimi display name mapping', () => {
  test('keeps the stable model id but shows the public display name', () => {
    expect(renderModelName('kimi-for-coding')).toBe('kimi-k2.6')
    expect(modelDisplayString('kimi-for-coding')).toBe('kimi-k2.6')
    expect(getMarketingNameForModel('kimi-for-coding')).toBe('kimi-k2.6')
  })
})
