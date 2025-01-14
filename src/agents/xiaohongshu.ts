import type { BrowserOptions } from '../browser'
import type { AgentOptions } from './agent'
import { matchKeywords, sleep } from '../utils'
import BrowserAgent from './agent'

export interface XiaohongshuAgentOptions extends AgentOptions {
  commentOption?: CommentOptions
}

export default class XiaohongshuAgent extends BrowserAgent {
  private MAX_OPERATION_NUM = 100
  private commentOptions: CommentOptions = {
    keywords: [],
    defaultReply: '',
  }

  constructor(agentOptions: XiaohongshuAgentOptions = {}, browserOptions: BrowserOptions = {}) {
    browserOptions.defaultViewport = browserOptions.defaultViewport || {
      width: 1600,
      height: 800,
    }
    super(agentOptions, browserOptions)
    this.commentOptions = {
      ...this.commentOptions,
      ...agentOptions.commentOption,
    }
  }

  async comment(): Promise<void> {
    try {
      await super.setup()
      await this.login()
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
    try {
      let commentCount = 0
      let errorCount = 0
      while (commentCount < this.MAX_OPERATION_NUM) {
        try {
          const num = await this.commentPage()
          commentCount += num
        } catch (error) {
          errorCount++
          console.error('Error during commenting:', error)
          if (errorCount > 10) {
            console.error('Too many errors, exiting')
            break
          }
          continue
        }
      }
      console.log('Total comments:', commentCount)
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
  }

  async login(): Promise<void> {
    const page = this.getPage()
    try {
      await page.goto('https://xiaohongshu.com/explore', {
        waitUntil: 'networkidle0',
        timeout: 30000,
      })

      const qrCode = await page.$('.qrcode.force-light')
      if (qrCode) {
        console.log('Xiaohongshu: User not logged in, Please log in')
        try {
          await page.waitForSelector('.user.side-bar-component', {
            timeout: 120000,
          })
        } catch (error) {
          console.error('Xiaohongshu: Could not log in:', error)
          throw error
        }
      }
      const user = await page.$('.user.side-bar-component')
      if (user) {
        console.log('Xiaohongshu: User logged in')
      } else {
        console.log('Xiaohongshu: User not logged in')
      }
    } catch (error) {
      console.error('Xiaohongshu: Could not open the page:', error)
      throw error
    }
  }

  async commentPage(): Promise<number> {
    const page = this.getPage()
    await page.waitForSelector('#exploreFeeds .note-item')
    await sleep(2000 * (0.5 + Math.random()))
    const sections = await page.$$('#exploreFeeds .note-item')
    let commentNum = 0
    const sectionNum = sections.length || 0
    if (sectionNum === 0) {
      console.log('No sections found')
      return commentNum
    }
    for (let i = 0; i < sectionNum; i++) {
      const section = sections[i]
      try {
        const sectionText = await page.evaluate(el => el.textContent, section)
        if (!matchKeywords(sectionText, this.commentOptions.keywords)) {
          continue
        }
        console.log('Matched:', sectionText)
        await section.scrollIntoView()
        await sleep(2000 * (0.5 + Math.random()))
        await page.waitForSelector('.cover.ld.mask')
        const link = await section.$('.cover.ld.mask')
        link?.click()
        console.log('Opened the post')
        await sleep(4000 * (0.5 + Math.random()))
        try {
          await page.waitForSelector('.interact-container .like-lottie')
          const likeBtn = await page.$('.interact-container .like-lottie')
          await likeBtn?.click()
          await page.waitForSelector('.content-edit .not-active.inner-when-not-active .inner')
          const inner = await page.$('.content-edit .not-active.inner-when-not-active .inner')
          await inner?.click()
          console.log('Clicked on Input Box')
          await sleep(2000 * (0.5 + Math.random()))
          await page.waitForSelector('#content-textarea')
          const commentText = this.commentOptions.defaultReply || ''
          await page.evaluate((text) => {
            const element = document.querySelector('#content-textarea')
            if (element) {
              element.textContent = text
              element.dispatchEvent(new Event('input', { bubbles: true }))
            }
          }, commentText)
          console.log('Commenting:', commentText)
          await sleep(2000 * (0.5 + Math.random()))
          await page.waitForSelector('.btn.submit')
          const submitButton = await page.$('.btn.submit')
          await submitButton?.click()
          console.log('Comment submitted')
          await sleep(4000 * (0.5 + Math.random()))
          await page.waitForSelector('.close.close-mask-dark')
          const closeBtn = await page.$('.close.close-mask-dark')
          await closeBtn?.click()
          console.log('Closed the post')
          await sleep(2000 * (0.5 + Math.random()))
        } catch (error) {
          console.error('Error during commentPost:', error)
        }
        commentNum++
      } catch (error) {
        console.error('Error during waiting:', error)
        continue
      }
    }

    try {
      await page.waitForSelector('a[href="/explore?channel_id=homefeed_recommend"]')
      const refreshButton = await page.$('a[href="/explore?channel_id=homefeed_recommend"]')
      await refreshButton?.click()
      console.log('Refreshed the page')
      await page.waitForSelector('#exploreFeeds .note-item', {
        timeout: 10000,
        visible: true,
      })
      await sleep(2000 * (0.5 + Math.random()))
    } catch (error) {
      console.error('Error during refresh:', error)
      return commentNum
    }

    return commentNum
  }
}

export interface CommentOptions {
  limit?: number
  keywords: string[]
  defaultReply?: string
  systemPrompt?: string
}
