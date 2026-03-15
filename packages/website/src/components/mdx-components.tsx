/*
 * MDX component mapping.
 *
 * Maps standard markdown elements to editorial components.
 * Also exposes custom components for use directly in MDX.
 *
 * Standard markdown fenced code blocks (```lang) are mapped to CodeBlock
 * via the pre/code override. MDX v3 parses markdown inside JSX components
 * when separated by blank lines.
 */

import {
  P,
  A,
  Code,
  CodeBlock,
  Caption,
  Section,
  ComparisonTable,
  List,
  OL,
  Li,
} from 'website/src/components/markdown'

export const mdxComponents = {
  /* Standard markdown element overrides */
  p: P,
  a: ({ href, children, ...props }: { href?: string; children: React.ReactNode }) => {
    return <A href={href || '#'}>{children}</A>
  },
  /* Fenced code blocks: MDX renders as <pre><code className="language-x">...</code></pre>.
     We unwrap <pre> and map <code> to CodeBlock when it has a language class. */
  pre: ({ children }: { children: React.ReactNode }) => {
    return <>{children}</>
  },
  code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    const lang = className?.replace('language-', '')
    if (lang) {
      return <CodeBlock lang={lang}>{String(children).replace(/\n$/, '')}</CodeBlock>
    }
    return <Code>{children}</Code>
  },
  ul: List,
  ol: OL,
  li: Li,

  /* Custom components available in MDX via JSX syntax */
  Section,
  CodeBlock,
  Caption,
  ComparisonTable,
  P,
  A,
  Code,
  List,
  OL,
  Li,
}
