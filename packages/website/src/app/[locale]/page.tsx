import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import matter from 'gray-matter'
import { MDXRemote } from 'next-mdx-remote/rsc'
import { routing } from 'website/src/i18n/routing'
import { EditorialPage } from 'website/src/components/markdown'
import { mdxComponents } from 'website/src/components/mdx-components'

interface TocItem {
  label: string
  href: string
}

interface ContentFrontmatter {
  title: string
  description: string
  toc: TocItem[]
}

export function generateStaticParams() {
  return routing.locales.map((locale) => {
    return { locale }
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })

  return {
    title: t('title'),
    description: t('description'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      url: 'https://runbrowser.dev',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
    },
  }
}

function loadContent(locale: string): { content: string; data: ContentFrontmatter } {
  const filePath = path.join(process.cwd(), 'content', locale, 'index.mdx')
  const raw = fs.readFileSync(filePath, 'utf-8')
  const { content, data } = matter(raw)
  return { content, data: data as ContentFrontmatter }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const { content, data } = loadContent(locale)

  return (
    <EditorialPage toc={data.toc} logo='runbrowser' locale={locale}>
      <MDXRemote source={content} components={mdxComponents} />
    </EditorialPage>
  )
}
