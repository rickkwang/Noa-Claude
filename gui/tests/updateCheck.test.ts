import { expect, test } from "bun:test"
import { pickLatest } from "../electron/updateCheck.cjs"

// The release feed is a shared contract: the desktop release workflow publishes gui-v<version> tags,
// and the CLI installer reads only vX.Y.Z tags. Drafts, prereleases and CLI tags must never be offered.
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://example.invalid/${tag}`,
  assets: [{ name: `Noa-Agent-${tag.replace("gui-v", "")}-arm64.dmg`, browser_download_url: `https://example.invalid/${tag}.dmg` }],
  ...extra,
})

test("picks the newest published gui release and its arm64 dmg", () => {
  const latest = pickLatest([
    release("gui-v1.20.0"),
    release("v9.9.9"),
    release("gui-v1.22.0", { prerelease: true }),
    release("gui-v1.23.0", { draft: true }),
    release("gui-v1.21.1"),
  ])
  expect(latest?.version).toBe("1.21.1")
  expect(latest?.url).toBe("https://example.invalid/gui-v1.21.1.dmg")
})

test("compares versions numerically, not lexically", () => {
  expect(pickLatest([release("gui-v1.9.0"), release("gui-v1.10.0")])?.version).toBe("1.10.0")
})

test("returns null when no published gui release exists", () => {
  expect(pickLatest([release("v1.0.0"), release("gui-v2.0.0", { draft: true })])).toBeNull()
})
