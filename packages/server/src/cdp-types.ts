import type { Protocol } from 'devtools-protocol'
import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js'

export type CDPCommandSource = 'termio-browser'

export type CDPCommandFor<T extends keyof ProtocolMapping.Commands> = {
  id: number
  sessionId?: string
  method: T
  params?: ProtocolMapping.Commands[T]['paramsType'][0]
  source?: CDPCommandSource
}

export type CDPCommand = {
  [K in keyof ProtocolMapping.Commands]: CDPCommandFor<K>
}[keyof ProtocolMapping.Commands]

export type CDPResponseFor<T extends keyof ProtocolMapping.Commands> = {
  id: number
  sessionId?: string
  result?: ProtocolMapping.Commands[T]['returnType']
  error?: { code?: number; message: string }
}

export type CDPResponse = {
  [K in keyof ProtocolMapping.Commands]: CDPResponseFor<K>
}[keyof ProtocolMapping.Commands]

export type CDPEventFor<T extends keyof ProtocolMapping.Events> = {
  method: T
  sessionId?: string
  params?: ProtocolMapping.Events[T][0]
}

export type CDPEvent = {
  [K in keyof ProtocolMapping.Events]: CDPEventFor<K>
}[keyof ProtocolMapping.Events]

export type CDPResponseBase = {
  id: number
  sessionId?: string
  result?: unknown
  error?: { code?: number; message: string }
}

export type CDPEventBase = {
  method: string
  sessionId?: string
  params?: unknown
}

export type CDPMessage = CDPCommand | CDPResponse | CDPEvent

export type RelayServerEvents = {
  'cdp:command': (data: { clientId: string; command: CDPCommand }) => void
  'cdp:event': (data: { event: CDPEventBase; sessionId?: string }) => void
  'cdp:response': (data: { clientId: string; response: CDPResponseBase; command: CDPCommand }) => void
}

export { Protocol, ProtocolMapping }
