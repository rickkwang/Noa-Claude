import { useEffect, useState } from "react"
import { FileText, Folder, X } from "../lib/icons"

type FileInfo = { directory: boolean; thumbnail?: string }
// Drafts remount the composer on every task switch; keep thumbnails so cards don't flash back to the icon.
const infoCache = new Map<string, Promise<FileInfo | undefined>>()

function fileInfo(path: string) {
  let info = infoCache.get(path)
  if (!info) {
    info = window.noaDesktop?.fileInfo?.(path).catch(() => undefined) ?? Promise.resolve(undefined)
    infoCache.set(path, info)
  }
  return info
}

export function FileAttachmentCard({ path, onRemove }: { path: string; onRemove: () => void }) {
  const [info, setInfo] = useState<FileInfo>()
  useEffect(() => {
    let current = true
    void fileInfo(path).then((next) => { if (current) setInfo(next) })
    return () => { current = false }
  }, [path])
  const name = path.replace(/\/+$/, "").split("/").pop() || path
  const Icon = info?.directory ? Folder : FileText
  const pdf = !info?.directory && /\.pdf$/i.test(name)
  return (
    <div className="noa-attachment relative block h-[122px] w-40 shrink-0 select-none" title={path}>
      <div className="flex size-full flex-col overflow-hidden rounded-2xl bg-[var(--bg-secondary)]">
        <div className="flex h-[90px] shrink-0 items-center justify-center overflow-hidden text-[var(--text-tertiary)]">
          {info?.thumbnail ? <img src={info.thumbnail} alt="" className="size-full object-cover object-left-top" /> : <Icon size={28} />}
        </div>
        <div className="flex h-8 min-w-0 shrink-0 items-center gap-1 bg-[var(--bg-card)] px-2 text-[12px] leading-4 text-[var(--text-primary)]">
          <Icon size={16} className={`shrink-0 ${pdf ? "text-[#E5483F]" : "text-[var(--text-secondary)]"}`} />
          <span className="truncate">{name}</span>
        </div>
      </div>
      <span aria-hidden="true" className="noa-attachment-ring" />
      <button type="button" aria-label={`Remove file ${name}`} onClick={onRemove} className="noa-attachment-remove">
        <X size={10} />
      </button>
    </div>
  )
}
