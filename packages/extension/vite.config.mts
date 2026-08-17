import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { extensionReload } from 'vite-plugin-extension-reload'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Bundle the runbrowser package version into the extension so it can report
// which runbrowser version it was built against. CLI/MCP use this to warn
// when the extension is outdated.
const runbrowserPkg = JSON.parse(readFileSync(resolve(__dirname, '../browser/package.json'), 'utf-8'))

const defineEnv: Record<string, string> = {
  'process.env.RUNBROWSER_PORT': JSON.stringify(process.env.RUNBROWSER_PORT || '19988'),
  __RUNBROWSER_VERSION__: JSON.stringify(runbrowserPkg.version),
}
if (process.env.TESTING) {
  defineEnv['import.meta.env.TESTING'] = 'true'
}

// Allow tests to build per-port extension outputs to avoid parallel run conflicts.
const outDir = process.env.RUNBROWSER_EXTENSION_DIST || 'dist'

export default defineConfig({
  plugins: [
    extensionReload(),
    viteStaticCopy({
      targets: [
        {
          src: resolve(__dirname, 'icons/*'),
          dest: 'icons',
        },

        {
          src: resolve(__dirname, 'manifest.json'),
          dest: '.',
          transform: (content) => {
            const manifest = JSON.parse(content)

            // Only include tabs permission during testing
            if (process.env.TESTING) {
              if (!manifest.permissions.includes('tabs')) {
                manifest.permissions.push('tabs')
              }
            }

            // Inject key for stable extension ID in dev/test builds (not production)
            // This ensures all developers get the same extension ID: pebbngnfojnignonigcnkdilknapkgid
            if (!process.env.PRODUCTION) {
              manifest.key =
                'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwCJoq5UYhOo5x8s50pVBUHjQ8idyUHnZFDj1JspWJPe6kvM7RFIaE/y5WTAH05kuK0R7v/ipcGA4ywA5wKdPKHZzkl5xstlNPj0Ivu4CqLobU7eY5G3k3Gq7wql2pbwb/A8Nat4VLbfBjQLA6TGWd3LQOHS6M0B3AvrtEw7DLDUdGKh4SCLewCbdlDIzpXQwKOzrRPyLFBwj9eEeITy5aNwJ9r9JMNBvACVZiRCHsGI6DufU+OiIO232l/8OoNNt6kdTMyNgiqOogFApXPJwREUwZHGqjXD3s6bXiBIQtwkNyZfemHKkxj6g/fhCV2EMgTY6+ikQEY1gEJMrRVmcYQIDAQAB'
            }

            return JSON.stringify(manifest, null, 2)
          },
        },
      ],
    }),
  ],

  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        offscreen: resolve(__dirname, 'src/offscreen.html'),
        welcome: resolve(__dirname, 'src/welcome.html'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  define: defineEnv,
})
