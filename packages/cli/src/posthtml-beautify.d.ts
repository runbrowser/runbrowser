declare module 'posthtml-beautify' {
  import type { Plugin } from 'posthtml'
  const beautify: (options?: Record<string, unknown>) => Plugin<unknown>
  export default beautify
}
