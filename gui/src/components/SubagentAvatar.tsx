import light0 from "../assets/subagents/blue-light.svg"
import dark0 from "../assets/subagents/blue-dark.svg"
import light1 from "../assets/subagents/yellow-light.svg"
import dark1 from "../assets/subagents/yellow-dark.svg"
import light2 from "../assets/subagents/pink-light.svg"
import dark2 from "../assets/subagents/pink-dark.svg"
import light3 from "../assets/subagents/agent-03-light.svg"
import dark3 from "../assets/subagents/agent-03-dark.svg"
import light4 from "../assets/subagents/agent-04-light.svg"
import dark4 from "../assets/subagents/agent-04-dark.svg"
import light5 from "../assets/subagents/agent-05-light.svg"
import dark5 from "../assets/subagents/agent-05-dark.svg"
import light6 from "../assets/subagents/agent-06-light.svg"
import dark6 from "../assets/subagents/agent-06-dark.svg"
import light7 from "../assets/subagents/agent-07-light.svg"
import dark7 from "../assets/subagents/agent-07-dark.svg"
import light8 from "../assets/subagents/agent-08-light.svg"
import dark8 from "../assets/subagents/agent-08-dark.svg"
import light9 from "../assets/subagents/agent-09-light.svg"
import dark9 from "../assets/subagents/agent-09-dark.svg"
import light10 from "../assets/subagents/agent-10-light.svg"
import dark10 from "../assets/subagents/agent-10-dark.svg"
import light11 from "../assets/subagents/agent-11-light.svg"
import dark11 from "../assets/subagents/agent-11-dark.svg"
import light12 from "../assets/subagents/agent-12-light.svg"
import dark12 from "../assets/subagents/agent-12-dark.svg"
import light13 from "../assets/subagents/agent-13-light.svg"
import dark13 from "../assets/subagents/agent-13-dark.svg"
import light14 from "../assets/subagents/agent-14-light.svg"
import dark14 from "../assets/subagents/agent-14-dark.svg"
import light15 from "../assets/subagents/agent-15-light.svg"
import dark15 from "../assets/subagents/agent-15-dark.svg"
import light16 from "../assets/subagents/agent-16-light.svg"
import dark16 from "../assets/subagents/agent-16-dark.svg"
import light17 from "../assets/subagents/agent-17-light.svg"
import dark17 from "../assets/subagents/agent-17-dark.svg"
import light18 from "../assets/subagents/agent-18-light.svg"
import dark18 from "../assets/subagents/agent-18-dark.svg"
import light19 from "../assets/subagents/agent-19-light.svg"
import dark19 from "../assets/subagents/agent-19-dark.svg"
import light20 from "../assets/subagents/agent-20-light.svg"
import dark20 from "../assets/subagents/agent-20-dark.svg"
import light21 from "../assets/subagents/agent-21-light.svg"
import dark21 from "../assets/subagents/agent-21-dark.svg"
import light22 from "../assets/subagents/agent-22-light.svg"
import dark22 from "../assets/subagents/agent-22-dark.svg"
import light23 from "../assets/subagents/agent-23-light.svg"
import dark23 from "../assets/subagents/agent-23-dark.svg"
import light24 from "../assets/subagents/agent-24-light.svg"
import dark24 from "../assets/subagents/agent-24-dark.svg"
import light25 from "../assets/subagents/agent-25-light.svg"
import dark25 from "../assets/subagents/agent-25-dark.svg"
import light26 from "../assets/subagents/agent-26-light.svg"
import dark26 from "../assets/subagents/agent-26-dark.svg"
import light27 from "../assets/subagents/agent-27-light.svg"
import dark27 from "../assets/subagents/agent-27-dark.svg"
import { useEffect, useState } from "react"

const avatars = [
  [light0, dark0],
  [light1, dark1],
  [light2, dark2],
  [light3, dark3],
  [light4, dark4],
  [light5, dark5],
  [light6, dark6],
  [light7, dark7],
  [light8, dark8],
  [light9, dark9],
  [light10, dark10],
  [light11, dark11],
  [light12, dark12],
  [light13, dark13],
  [light14, dark14],
  [light15, dark15],
  [light16, dark16],
  [light17, dark17],
  [light18, dark18],
  [light19, dark19],
  [light20, dark20],
  [light21, dark21],
  [light22, dark22],
  [light23, dark23],
  [light24, dark24],
  [light25, dark25],
  [light26, dark26],
  [light27, dark27],
]

export function SubagentAvatar({ id, size = 14 }: { id: string; size?: number }) {
  const [darkTheme, setDarkTheme] = useState(() => document.documentElement.dataset.theme === "dark")
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDarkTheme(root.dataset.theme === "dark"))
    setDarkTheme(root.dataset.theme === "dark")
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])
  let hash = 0
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) % 2147483647
  const [light, dark] = avatars[hash % avatars.length]!
  return <img data-subagent-avatar className="shrink-0" style={{ width: size, height: size }} src={darkTheme ? dark : light} alt="" draggable={false} />
}
