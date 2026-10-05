// The Mushaf: tells the Mushaf app when an OpenCode session starts working, finishes,
// or waits for you. Added by `mushaf integrations install opencode`; remove it with
// `mushaf integrations uninstall opencode`. Only the session id and the folder are passed on.
import { spawn } from "node:child_process"

const CLI = __MUSHAF_CLI__

export const MushafPlugin = async ({ directory }) => {
  // Sub-agents' sessions work inside their parent's task.
  const children = new Set()
  const working = new Set()
  const stopped = new Set()

  const tell = (kind, session) => {
    try {
      const hook = spawn(CLI, ["hook", "opencode", kind], { stdio: ["pipe", "ignore", "ignore"], detached: true })
      hook.on("error", () => {})
      hook.stdin.on("error", () => {})
      hook.stdin.end(JSON.stringify({ session_id: session, cwd: directory }))
      hook.unref()
    } catch {}
  }

  return {
    event: async ({ event }) => {
      const properties = event.properties ?? {}
      const session = properties.sessionID
      switch (event.type) {
        case "session.created":
        case "session.updated":
          if (properties.info?.parentID) children.add(properties.info.id)
          break
        case "session.status": {
          if (!session || children.has(session)) break
          const type = properties.status?.type
          if ((type === "busy" || type === "retry") && !working.has(session)) {
            working.add(session)
            stopped.delete(session)
            tell("started", session)
          } else if (type === "idle" && working.delete(session)) {
            tell(stopped.delete(session) ? "ended" : "finished", session)
          }
          break
        }
        case "session.error":
          // Esc ends the task with this error, then the session goes idle.
          if (session && properties.error?.name === "MessageAbortedError") stopped.add(session)
          break
        case "permission.asked":
        case "permission.updated":
        case "question.asked":
          if (session) tell("attention", session)
          break
        case "session.deleted":
          if (properties.info?.id && working.delete(properties.info.id)) tell("ended", properties.info.id)
          break
      }
    },
  }
}
