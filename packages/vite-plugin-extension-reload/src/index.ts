/**
 * vite-plugin-extension-reload
 *
 * Auto-reloads Chrome/MV3 browser extensions during development.
 *
 * - `vite build --watch` → starts WS server, injects reload client, auto-reloads on rebuild
 * - `vite build`         → does nothing (production safe)
 *
 * @example
 * ```ts
 * import { extensionReload } from 'vite-plugin-extension-reload'
 *
 * export default defineConfig({
 *   plugins: [extensionReload()],
 * })
 * ```
 */

import type { Plugin, ResolvedConfig } from 'vite'
import { WebSocketServer, WebSocket } from 'ws'

export interface ExtensionReloadOptions {
  /**
   * WebSocket server port.
   * @default 19987
   */
  port?: number

  /**
   * Service worker entry filename to inject reload client into.
   * Matched against the chunk's `facadeModuleId` or output `fileName`.
   * @default 'background.ts'
   */
  entry?: string

  /**
   * Delay (ms) after build before signaling reload.
   * Ensures all files are written to disk before the extension reads them.
   * @default 300
   */
  delay?: number
}

export function extensionReload(options: ExtensionReloadOptions = {}): Plugin {
  const port = options.port ?? 19987
  const entry = options.entry ?? 'background.ts'
  const delay = options.delay ?? 300
  const entryOutputName = entry.replace(/\.tsx?$/, '.js')

  let wss: WebSocketServer | null = null
  let isWatch = false

  function broadcast() {
    if (!wss) return
    let count = 0
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'reload' }))
        count++
      }
    }
    if (count > 0) {
      console.log(`[extension-reload] build done → reloading ${count} client(s)`)
    }
  }

  const clientCode = `
;(function(){
  var url='ws://127.0.0.1:${port}',ws,timer;
  function connect(){
    if(ws&&(ws.readyState===0||ws.readyState===1))return;
    try{ws=new WebSocket(url)}catch(e){retry();return}
    ws.onopen=function(){console.log('[extension-reload] connected')};
    ws.onmessage=function(e){
      try{if(JSON.parse(e.data).type==='reload'){console.log('[extension-reload] reloading...');chrome.runtime.reload()}}catch(x){}
    };
    ws.onclose=function(){ws=null;retry()};
    ws.onerror=function(){try{ws.close()}catch(x){}ws=null;retry()};
  }
  function retry(){if(!timer)timer=setTimeout(function(){timer=null;connect()},2000)}
  connect();
})();
`

  return {
    name: 'vite-plugin-extension-reload',
    apply: 'build',

    configResolved(config: ResolvedConfig) {
      isWatch = !!config.build.watch
    },

    renderChunk(code, chunk) {
      if (!isWatch) return null
      const match = chunk.facadeModuleId?.endsWith(entry) || chunk.fileName === entryOutputName
      if (!match) return null
      console.log(`[extension-reload] injecting reload client into ${chunk.fileName}`)
      return { code: code + '\n' + clientCode, map: null }
    },

    buildStart() {
      if (!isWatch || wss) return
      wss = new WebSocketServer({ port })
      wss.on('listening', () => {
        console.log(`[extension-reload] ws://127.0.0.1:${port}`)
      })
      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[extension-reload] port ${port} in use, disabled`)
        }
        wss = null
      })
    },

    writeBundle() {
      if (!isWatch || !wss) return
      setTimeout(broadcast, delay)
    },

    closeBundle() {
      if (wss) {
        wss.close()
        wss = null
      }
    },
  }
}
