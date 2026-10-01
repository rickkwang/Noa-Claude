import { createContext, useCallback, useEffect, useReducer, type SetStateAction } from 'react'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type { NetworkHostPattern } from '../../utils/sandbox/sandbox-adapter.js'
import type { ToolUseConfirm } from './PermissionRequest.js'

export const PermissionQueueCountContext = createContext<string | null>(null)

type NetworkRequest = { hostPattern: NetworkHostPattern; resolvePromise: (allow: boolean) => void }
type State = { tools: ToolUseConfirm[]; sandbox: NetworkRequest[]; workers: string[]; settled: number }
type Action =
  | { queue: 'tools'; update: SetStateAction<ToolUseConfirm[]> }
  | { queue: 'sandbox'; update: SetStateAction<NetworkRequest[]> }
  | { queue: 'workers'; ids: string[] }

function pendingRequests(state: State): Set<unknown> {
  return new Set([
    ...state.tools.filter(item => item.tool.name !== 'AskUserQuestion').map(item => `tool:${item.toolUseID}`),
    ...state.sandbox.map(item => item.resolvePromise),
    ...state.workers.map(id => `worker-network:${id}`),
  ])
}

function reduceQueue(state: State, action: Action): State {
  const next = { ...state }
  if (action.queue === 'tools') next.tools = typeof action.update === 'function' ? action.update(state.tools) : action.update
  else if (action.queue === 'sandbox') next.sandbox = typeof action.update === 'function' ? action.update(state.sandbox) : action.update
  else next.workers = action.ids
  // Keep useState's same-reference bailout for updaters that return the queue unchanged.
  if (next.tools === state.tools && next.sandbox === state.sandbox && next.workers === state.workers) return state
  const before = pendingRequests(state)
  const after = pendingRequests(next)
  next.settled = after.size === 0 ? 0 : state.settled + [...before].filter(id => !after.has(id)).length
  return next
}

export function usePermissionQueues(store: AppStateStore) {
  const [state, dispatch] = useReducer(reduceQueue, store, initialStore => ({
    tools: [], sandbox: [], workers: initialStore.getState().workerSandboxPermissions.queue.map(item => item.requestId), settled: 0,
  }))
  const setToolUseConfirmQueue = useCallback((update: SetStateAction<ToolUseConfirm[]>) => dispatch({ queue: 'tools', update }), [])
  const setSandboxPermissionRequestQueue = useCallback((update: SetStateAction<NetworkRequest[]>) => dispatch({ queue: 'sandbox', update }), [])
  useEffect(() => {
    let previous: unknown
    const sync = () => {
      const queue = store.getState().workerSandboxPermissions.queue
      if (queue === previous) return
      previous = queue
      dispatch({ queue: 'workers', ids: queue.map(item => item.requestId) })
    }
    const unsubscribe = store.subscribe(sync)
    sync()
    return unsubscribe
  }, [store])
  const pending = pendingRequests(state).size
  const total = state.settled + pending
  return {
    toolUseConfirmQueue: state.tools, setToolUseConfirmQueue,
    sandboxPermissionRequestQueue: state.sandbox, setSandboxPermissionRequestQueue,
    permissionQueueLabel: pending > 0 && total > 1 ? `${state.settled + 1} of ${total}` : null,
  }
}
