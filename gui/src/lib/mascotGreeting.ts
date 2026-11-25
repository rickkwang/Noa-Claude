// What the new-task mascot says when the page opens. Each line rests on something true about now
// (the hour, the weekday, when the user last worked), and stays the same for that situation all day.

export interface GreetingContext {
  now: Date
  name?: string
  project: string
  // Newest session update in this project and across every project, in ms.
  lastHere?: number
  lastAny?: number
}

export interface Greeting {
  text: string
  animation: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

const LINES = {
  late: ["Still up, {name}? I’ll keep you company.", "The quiet hours. Good time to think.", "Late one, huh? Let’s make it count."],
  away: ["It’s been {days} days, {name}. I kept your seat warm.", "There you are. {project} missed you."],
  recent: ["Back so soon? I like that.", "Picking up where we left off?"],
  friday: ["Friday evening. Something small and satisfying?", "It’s Friday, {name}. Finish strong or start something fun?"],
  weekend: ["A weekend project? My favorite kind.", "{weekday} hacking. No meetings, just us."],
  early: ["You’re up early, {name}. Fresh start.", "Early bird. The world’s still quiet."],
  morning: ["Morning, {name}. What’s first today?", "Coffee’s on. What are we starting in {project}?"],
  afternoon: ["Afternoon, {name}. How’s the day treating you?", "Post-lunch slump? I’ve got energy for two."],
  evening: ["Evening, {name}. One more thing, or calling it a day?", "The day’s winding down. Anything worth finishing?"],
} as const

const ANIMATION: Record<keyof typeof LINES, string> = {
  late: "Coffee",
  away: "Excited",
  recent: "Waving",
  friday: "Sunglasses",
  weekend: "Laptop",
  early: "Coffee",
  morning: "Waving",
  afternoon: "Waving",
  evening: "Waving",
}

export const MASCOT_REPLIES = [
  "That tickles.",
  "I’m mostly here for moral support.",
  "Psst. The box below is where it starts.",
  "I’d type, but no thumbs.",
  "Still here. Still cheering.",
  "Okay, okay. I’m listening.",
]

function situation({ now, lastHere, lastAny }: GreetingContext): keyof typeof LINES {
  const hour = now.getHours()
  const day = now.getDay()
  const since = (at?: number) => (at === undefined ? Infinity : now.getTime() - at)
  if (hour < 5) return "late"
  if (lastAny !== undefined && since(lastAny) >= 3 * DAY) return "away"
  if (since(lastHere) < 2 * HOUR) return "recent"
  if (day === 5 && hour >= 17) return "friday"
  if (day === 0 || day === 6) return "weekend"
  if (hour < 9) return "early"
  if (hour < 12) return "morning"
  if (hour < 18) return "afternoon"
  return "evening"
}

function fill(template: string, context: GreetingContext): string {
  const days = context.lastAny === undefined ? 0 : Math.floor((context.now.getTime() - context.lastAny) / DAY)
  const named = context.name
    ? template.replaceAll("{name}", context.name)
    : template.replaceAll(", {name}", "").replaceAll("{name}", "friend")
  return named
    .replaceAll("{project}", context.project)
    .replaceAll("{days}", String(days))
    .replaceAll("{weekday}", context.now.toLocaleDateString("en-US", { weekday: "long" }))
}

export function greetingFor(context: GreetingContext): Greeting {
  const key = situation(context)
  const lines = LINES[key]
  // Same situation, same day, same line; tomorrow it may change.
  const seed = `${context.now.toDateString()}|${key}`
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { text: fill(lines[hash % lines.length]!, context), animation: ANIMATION[key] }
}
