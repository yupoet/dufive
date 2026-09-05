import { useEffect, useState } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let updateReady = false

/** Called by the service-worker registration when a new version is waiting. */
export function notifyUpdateReady(): void {
  updateReady = true
  for (const listener of listeners) listener()
}

/**
 * Offers a reload when a new service worker has been installed. Updates are
 * otherwise silent, which would leave players on a stale build until the tab
 * happens to reopen.
 */
export function UpdateToast() {
  const [ready, setReady] = useState(updateReady)

  useEffect(() => {
    const listener = () => setReady(updateReady)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (!ready) return null

  return (
    <div className="update-toast" role="status" data-testid="update-toast">
      <span>新版本已经就绪。</span>
      <button type="button" onClick={() => window.location.reload()}>
        刷新
      </button>
    </div>
  )
}

export default UpdateToast
