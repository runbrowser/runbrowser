# vite-plugin-extension-reload

Auto-reloads Chrome/MV3 browser extensions during `vite build --watch`. Zero config, production safe.

## How it works

1. Detects `--watch` mode automatically
2. Starts a tiny WebSocket server
3. Injects a reload client into the service worker entry
4. On each rebuild → signals the client → `chrome.runtime.reload()`

In production builds (`vite build`), the plugin does nothing.

## Install

```bash
npm install -D vite-plugin-extension-reload
```

## Usage

```ts
// vite.config.ts
import { extensionReload } from 'vite-plugin-extension-reload'

export default defineConfig({
  plugins: [extensionReload()],
})
```

Then run:

```bash
vite build --watch
```

Load `dist/` as an unpacked extension in `chrome://extensions` (Developer mode). Any source change will auto-rebuild and auto-reload the extension.

## Options

```ts
extensionReload({
  port: 19987,           // WebSocket server port (default: 19987)
  entry: 'background.ts', // service worker entry to inject into (default: 'background.ts')
  delay: 300,            // ms delay after build before reload signal (default: 300)
})
```

## License

MIT
