interface ExtensionState {
  tabs: Map<number, unknown>
  connectionState: string
  currentTabId: number | undefined
  errorText: string | undefined
}

declare global {
  // eslint-disable-next-line no-var
  var toggleExtensionForActiveTab: () => Promise<{ isConnected: boolean; state: ExtensionState }>
  // eslint-disable-next-line no-var
  var getExtensionState: () => ExtensionState
  // eslint-disable-next-line no-var
  var disconnectEverything: () => Promise<void>
}

export {}
