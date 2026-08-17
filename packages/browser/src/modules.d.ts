/**
 * Markdown imported with `with { type: 'text' }`.
 *
 * These files are read at runtime by `skill` and by the MCP skill tool. Reading
 * them off disk works from source and fails inside a `bun build --compile`
 * binary, where __dirname is /$bunfs/root and nothing is on the filesystem.
 * Importing them embeds the content at build time, so both shapes behave the
 * same.
 */
declare module '*.md' {
  const content: string
  export default content
}
