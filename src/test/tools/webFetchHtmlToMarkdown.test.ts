import { describe, expect, test } from 'bun:test'
import { htmlToMarkdown } from '../../tools/WebFetchTool/utils.js'

// Deeply nested lists used to grow output quadratically (each level re-indents
// every line of its children), and style/script text leaked into the markdown.
// These cases pin the depth cap and the tag removal.

const nestedList = (depth: number) => {
  let html = '<li>leaf</li>'
  for (let i = 0; i < depth; i++) html = `<li>item ${i}<ul>${html}</ul></li>`
  return `<ul>${html}</ul>`
}

describe('htmlToMarkdown — nesting depth cap', () => {
  test('keeps list markers within the depth limit', async () => {
    const md = await htmlToMarkdown(nestedList(3))
    expect(md).toContain('item 0')
    expect(md.match(/^\s*\*\s/gm)).toHaveLength(4)
  })

  test('drops list markup past 12 levels but keeps the text', async () => {
    const md = await htmlToMarkdown(nestedList(40))
    expect(md).toContain('leaf')
    expect(md.match(/^\s*\*\s/gm)).toHaveLength(12)
  })
})

describe('htmlToMarkdown — non-content elements', () => {
  test('removes style and script text', async () => {
    const md = await htmlToMarkdown(
      '<p>visible</p><style>.a{color:red}</style><script>var z=9</script>',
    )
    expect(md).toBe('visible')
  })
})
