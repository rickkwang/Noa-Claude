// @ts-nocheck
import type * as React from 'react';
import { useCallback, useEffect } from 'react';
import { useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import type { Theme } from '../utils/theme.js';
type Priority = 'low' | 'medium' | 'high' | 'immediate';
type BaseNotification = {
  key: string;
  /**
   * Show this even while the diff panel is open. The panel is a reading
   * surface, so transient toasts are held back while it's up — except for the
   * ones that report a state the user needs to act on regardless (e.g. the
   * context-window warning).
   */
  exemptFromDiffPanelHold?: boolean;
  /**
   * Set on an `immediate` notification that arrived while the diff panel was
   * holding the row. It waits in the queue like any other, but keeps its
   * priority: it survives later immediates and preempts a lower-priority
   * current once the hold lifts.
   */
  heldDuringDiffPanel?: boolean;
  /**
   * Keys of notifications that this notification invalidates.
   * If a notification is invalidated, it will be removed from the queue
   * and, if currently displayed, cleared immediately.
   */
  invalidates?: string[];
  priority: Priority;
  timeoutMs?: number;
  /**
   * Combine notifications with the same key, like Array.reduce().
   * Called as fold(accumulator, incoming) when a notification with a matching
   * key already exists in the queue or is currently displayed.
   * Returns the merged notification (should carry fold forward for future merges).
   */
  fold?: (accumulator: Notification, incoming: Notification) => Notification;
};
type TextNotification = BaseNotification & {
  text: string;
  color?: keyof Theme;
};
type JSXNotification = BaseNotification & {
  jsx: React.ReactNode;
};
type AddNotificationFn = (content: Notification) => void;
type RemoveNotificationFn = (key: string) => void;
export type Notification = TextNotification | JSXNotification;
const DEFAULT_TIMEOUT_MS = 8000;

// Track current timeout to clear it when immediate notifications arrive
let currentTimeoutId: NodeJS.Timeout | null = null;
export function useNotifications(): {
  addNotification: AddNotificationFn;
  removeNotification: RemoveNotificationFn;
  processQueue: () => void;
} {
  const store = useAppStateStore();
  const setAppState = useSetAppState();

  // Process queue when current notification finishes or queue changes
  const processQueue = useCallback(() => {
    setAppState(prev => {
      const next = getNext(prev.diffPanelVisible ? prev.notifications.queue.filter(_ => _.exemptFromDiffPanelHold) : prev.notifications.queue);
      if (!next) {
        return prev;
      }
      const current = prev.notifications.current;
      const preempted = current !== null && next.priority === 'immediate' && next.heldDuringDiffPanel === true && current.priority !== 'immediate' ? current : null;
      if (current !== null && preempted === null) {
        return prev;
      }
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      currentTimeoutId = setTimeout((setAppState, nextKey, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== nextKey) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue,
              current: null
            }
          };
        });
        processQueue();
      }, next.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, next.key, processQueue);
      return {
        ...prev,
        notifications: {
          queue: [...(preempted !== null && survivesPreemption(preempted, next) ? [preempted] : []), ...prev.notifications.queue.filter(_ => _ !== next)],
          current: next.heldDuringDiffPanel ? {
            ...next,
            heldDuringDiffPanel: undefined
          } : next
        }
      };
    });
  }, [setAppState]);
  const addNotification = useCallback<AddNotificationFn>((notif: Notification) => {
    // Immediate notifications cut the line — except while the diff panel holds
    // the row, where they queue marked `heldDuringDiffPanel` instead.
    if (notif.priority === 'immediate' && !store.getState().diffPanelVisible) {
      // Clear any existing timeout since we're showing a new immediate notification
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }

      // Set up timeout for the immediate notification
      currentTimeoutId = setTimeout((setAppState, notif, processQueue) => {
        currentTimeoutId = null;
        setAppState(prev => {
          // Compare by key instead of reference to handle re-created notifications
          if (prev.notifications.current?.key !== notif.key) {
            return prev;
          }
          return {
            ...prev,
            notifications: {
              queue: prev.notifications.queue.filter(_ => !notif.invalidates?.includes(_.key)),
              current: null
            }
          };
        });
        processQueue();
      }, notif.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, notif, processQueue);

      // Show the immediate notification right away
      setAppState(prev => ({
        ...prev,
        notifications: {
          current: notif,
          queue: [...(prev.notifications.current ? [prev.notifications.current] : []), ...prev.notifications.queue].filter(_ => survivesPreemption(_, notif))
        }
      }));
      return; // IMPORTANT: Exit addNotification for immediate notifications
    }

    const queued = notif.priority === 'immediate' ? {
      ...notif,
      heldDuringDiffPanel: true
    } : notif;
    setAppState(prev => {
      // Check if we can fold into an existing notification with the same key
      if (queued.fold) {
        // Fold into current notification if keys match
        if (prev.notifications.current?.key === queued.key) {
          const folded = queued.fold(prev.notifications.current, queued);
          // Reset timeout for the folded notification
          if (currentTimeoutId) {
            clearTimeout(currentTimeoutId);
            currentTimeoutId = null;
          }
          currentTimeoutId = setTimeout((setAppState, foldedKey, processQueue) => {
            currentTimeoutId = null;
            setAppState(p => {
              if (p.notifications.current?.key !== foldedKey) {
                return p;
              }
              return {
                ...p,
                notifications: {
                  queue: p.notifications.queue,
                  current: null
                }
              };
            });
            processQueue();
          }, folded.timeoutMs ?? DEFAULT_TIMEOUT_MS, setAppState, folded.key, processQueue);
          return {
            ...prev,
            notifications: {
              current: folded,
              queue: prev.notifications.queue
            }
          };
        }

        // Fold into queued notification if keys match
        const queueIdx = prev.notifications.queue.findIndex(_ => _.key === queued.key);
        if (queueIdx !== -1) {
          const folded = queued.fold(prev.notifications.queue[queueIdx]!, queued);
          const newQueue = [...prev.notifications.queue];
          newQueue[queueIdx] = folded;
          return {
            ...prev,
            notifications: {
              current: prev.notifications.current,
              queue: newQueue
            }
          };
        }
      }

      // Only add to queue if not already present (prevent duplicates)
      const queuedKeys = new Set(prev.notifications.queue.map(_ => _.key));
      const shouldAdd = !queuedKeys.has(queued.key) && prev.notifications.current?.key !== queued.key;
      if (!shouldAdd) return prev;
      const invalidatesCurrent = prev.notifications.current !== null && queued.invalidates?.includes(prev.notifications.current.key);
      if (invalidatesCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: invalidatesCurrent ? null : prev.notifications.current,
          queue: [...prev.notifications.queue.filter(_ => survivesPreemption(_, queued)), queued]
        }
      };
    });

    // Process queue after adding the notification
    processQueue();
  }, [setAppState, processQueue, store]);
  const removeNotification = useCallback<RemoveNotificationFn>((key: string) => {
    setAppState(prev => {
      const isCurrent = prev.notifications.current?.key === key;
      const inQueue = prev.notifications.queue.some(n => n.key === key);
      if (!isCurrent && !inQueue) {
        return prev;
      }
      if (isCurrent && currentTimeoutId) {
        clearTimeout(currentTimeoutId);
        currentTimeoutId = null;
      }
      return {
        ...prev,
        notifications: {
          current: isCurrent ? null : prev.notifications.current,
          queue: prev.notifications.queue.filter(n => n.key !== key)
        }
      };
    });
    processQueue();
  }, [setAppState, processQueue]);

  // Drain on mount, then whenever something lands in the queue while nothing is
  // showing. addNotification drains for its own callers, but code outside React
  // — a tool writing through ToolUseContext.setAppState, for one — can only
  // append to the queue, and without this its notification would sit there
  // until some unrelated notification happened to finish and drain it.
  //
  // store.subscribe rather than useAppState: this reacts to queue changes
  // without re-rendering every component that calls useNotifications.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // biome-ignore lint/correctness/useExhaustiveDependencies: store is a stable context ref
  useEffect(() => {
    const drainIfIdle = () => {
      const { notifications } = store.getState();
      if (notifications.current === null && notifications.queue.length > 0) {
        processQueue();
      }
    };
    drainIfIdle();
    return store.subscribe(drainIfIdle);
  }, [processQueue]);
  return {
    addNotification,
    removeNotification,
    // Exposed so the diff panel can drain anything held while it was open the
    // moment it closes, instead of leaving it stuck until the next event.
    processQueue
  };
}
const PRIORITIES: Record<Priority, number> = {
  immediate: 0,
  high: 1,
  medium: 2,
  low: 3
};
/**
 * Whether the current notification should actually be painted. The diff panel
 * is a reading surface: while it is up, only notifications that opted out of
 * the hold are shown. Held ones stay in `current` and reappear when it closes.
 */
export function isNotificationVisible(
  current: Notification | null,
  diffPanelVisible: boolean,
): boolean {
  return current !== null && (!diffPanelVisible || current.exemptFromDiffPanelHold === true);
}

/**
 * Whether a displaced or queued notification stays queued when `incoming`
 * arrives. Immediates are dropped rather than replayed, unless they were only
 * waiting out the diff panel's hold.
 */
export function survivesPreemption(queued: Notification, incoming: Notification): boolean {
  return (queued.priority !== 'immediate' || queued.heldDuringDiffPanel === true) && !incoming.invalidates?.includes(queued.key);
}
export function getNext(queue: Notification[]): Notification | undefined {
  if (queue.length === 0) return undefined;
  return queue.reduce((min, n) => PRIORITIES[n.priority] < PRIORITIES[min.priority] ? n : min);
}
