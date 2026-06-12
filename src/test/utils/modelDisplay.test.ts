import { describe, expect, test } from 'bun:test'
import {
  getMarketingNameForModel,
  modelDisplayString,
  renderModelName,
} from '../../utils/model/model.js'

describe('Kimi display name mapping', () => {
  test('renders the model id as-is with no display special-casing', () => {
    expect(renderModelName('kimi-for-coding')).toBe('kimi-for-coding')
    expect(modelDisplayString('kimi-for-coding')).toBe('kimi-for-coding')
    expect(getMarketingNameForModel('kimi-for-coding')).toBeUndefined()
  })
})
