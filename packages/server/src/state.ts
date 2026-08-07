/**
 * Relay state — simplified for direct CDP mode (no extension).
 *
 * Holds session metadata and Playwright client connections.
 */
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { WSContext } from 'hono/ws'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Session metadata identifying which browser a session is connected to. */
export type SessionMetadata = {
  browser: string | null
  profile: { email: string; id: string } | null
}

export type PlaywrightClient = {
  id: string
  ws: WSContext
}

export type RelayState = {
  playwrightClients: Map<string, PlaywrightClient>
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export function createRelayStore(): StoreApi<RelayState> {
  return createStore<RelayState>(() => ({
    playwrightClients: new Map(),
  }))
}

// ---------------------------------------------------------------------------
// Pure state transition functions
// ---------------------------------------------------------------------------

/** Add a playwright client. */
export function addPlaywrightClient(
  state: RelayState,
  { id, ws }: { id: string; ws: WSContext },
): RelayState {
  const newClients = new Map(state.playwrightClients)
  newClients.set(id, { id, ws })
  return { ...state, playwrightClients: newClients }
}

/** Remove a playwright client. */
export function removePlaywrightClient(state: RelayState, { clientId }: { clientId: string }): RelayState {
  if (!state.playwrightClients.has(clientId)) {
    return state
  }
  const newClients = new Map(state.playwrightClients)
  newClients.delete(clientId)
  return { ...state, playwrightClients: newClients }
}
