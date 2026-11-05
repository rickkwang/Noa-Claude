interface RecentFile { cwd: string; path: string }
const KEY = "noa-agent.recentFiles"

export function recentFiles(): RecentFile[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(value) ? value.filter(item => typeof item?.cwd === "string" && typeof item?.path === "string").slice(0, 20) : []
  } catch { return [] }
}

export function rememberFile(cwd: string, path: string): void {
  try {
    const files = recentFiles().filter(file => file.cwd !== cwd || file.path !== path)
    localStorage.setItem(KEY, JSON.stringify([{ cwd, path }, ...files].slice(0, 20)))
  } catch { /* A full storage quota must not prevent opening a file. */ }
}
