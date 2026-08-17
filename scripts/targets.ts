/**
 * Platforms that get a compiled binary.
 *
 * Every entry becomes a permanent npm name and a permanent trusted-publisher
 * configuration. Adding one later is a line here and a new package; removing
 * one after somebody's lockfile references it is not possible. So this lists
 * the platforms there is a reason to ship, not the platforms bun can target.
 *
 * linux-arm64 and win32-x64 compile fine — the code is careful about platform,
 * down to netstat/taskkill in kill-port — but nothing has run there. They go in
 * when someone asks, and the launcher already fails with a legible message
 * naming the missing package.
 */
export const TARGETS = [
  { bunTarget: 'bun-darwin-arm64', os: 'darwin', cpu: 'arm64' },
  { bunTarget: 'bun-darwin-x64', os: 'darwin', cpu: 'x64' },
  // The agent may run on a Linux box while Chrome stays on the user's Mac, so
  // the CLI has to exist there even where a browser does not.
  { bunTarget: 'bun-linux-x64', os: 'linux', cpu: 'x64' },
] as const

export function packageNameFor(target: { os: string; cpu: string }): string {
  return `@termio/browser-${target.os}-${target.cpu}`
}

/**
 * The optionalDependencies a published manifest carries.
 *
 * These are deliberately absent from packages/browser/package.json. They name
 * packages that only exist once a release publishes them, so declaring them in
 * the source manifest would make `pnpm install --frozen-lockfile` unsatisfiable
 * on a clean checkout — which is exactly how it failed in CI.
 */
export function optionalDependenciesFor(version: string): Record<string, string> {
  return Object.fromEntries(TARGETS.map((target) => [packageNameFor(target), version]))
}
