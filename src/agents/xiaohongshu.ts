import type { Page } from 'puppeteer'
import type { BrowserOptions } from '../browser'
import { sleep } from '../utils'
import BaseAgent from './agent'

export default class XiaohongshuAgent extends BaseAgent {
  private MAX_OPERATION_NUM = 100

  constructor(browserOptions: BrowserOptions) {
    browserOptions.defaultViewport = browserOptions.defaultViewport || {
      width: 1600,
      height: 900,
    }
    super(browserOptions)
  }

  async run(): Promise<void> {
    try {
      await super.setup()
      await this.login(this.getPage())
    } catch (error) {
      console.error('Error:', error)
      throw error
    }

    try {
      const page: Page = this.getPage()
      let commentCount = 0
      while (commentCount < this.MAX_OPERATION_NUM) {
        const num = await this.autoComment(page)
        commentCount += num
      }

      console.log('Total comments:', commentCount)
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
  }

  async login(page: Page): Promise<void> {
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

  async autoComment(page: Page): Promise<number> {
    try {
      await page.waitForSelector('#exploreFeeds .note-item')
    } catch (error) {
      console.error('Error during waiting:', error)
      return 0
    }

    const sections = await page.$$('#exploreFeeds .note-item')
    let commentNum = 0

    for (const section of sections) {
      try {
        const sectionText = await page.evaluate(el => el.textContent, section)
        if (sectionText?.includes('英语') || sectionText?.includes('口语') || sectionText?.includes('新概念')) {
          await section.scrollIntoView()
          const link = await section.$('.cover.ld.mask')
          if (link) {
            await link.click()
            console.log('Clicked on the link')
          } else {
            console.log('Link not found')
            continue
          }
        } else {
          continue
        }
      } catch (error) {
        console.error('Error during clicking:', error)
        continue
      }

      try {
        await page.waitForSelector('.btn.submit.gray')
        await page.waitForSelector('.interact-container .like-lottie')
      } catch (error) {
        console.error('Error during waiting:', error)
        continue
      }

      const likeBtn = await page.$('.interact-container .like-lottie')
      if (likeBtn) {
        await likeBtn.click()
        console.log('Clicked on the like button')
        sleep(3000)
      } else {
        console.log('Like button not found')
      }

      try {
        await page.waitForSelector('div[data-v-b91d006a].inner')
      } catch (error) {
        console.error('Error during waiting:', error)
        continue
      }

      const inner = await page.$('div[data-v-b91d006a].inner')
      sleep(2000 * (0.5 + Math.random()))
      if (inner) {
        await inner.click()
        console.log('Clicked on the inner')
      } else {
        console.log('Inner not found')
      }

      try {
        await page.waitForSelector('#content-textarea')
      } catch (error) {
        console.error('Error during waiting:', error)
        continue
      }

      await page.evaluate((text) => {
        const element = document.querySelector('#content-textarea')
        if (element) {
          element.textContent = text
          element.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }, '给你推荐一个特别好用影子跟读网站，hispeaking.com，沉浸式跟读，体验特别不错')

      const content = await page.$eval('#content-textarea', el => el.textContent)
      console.log('Content entered:', content)
      await sleep(2000 * (0.5 + Math.random()))

      const submitButton = await page.$('.btn.submit')
      if (submitButton) {
        await submitButton.click()
        console.log('Clicked on the submit button')
        await sleep(3000 * (0.5 + Math.random()))
      } else {
        console.log('Submit button not found')
        continue
      }

      try {
        await page.waitForSelector('.close.close-mask-dark')
      } catch (error) {
        console.error('Error during waiting:', error)
        continue
      }

      const closeBtn = await page.$('.close.close-mask-dark')
      if (closeBtn) {
        await closeBtn.click()
        await sleep(2000 * (0.5 + Math.random()))
        console.log('Went back to the previous page')
      } else {
        console.log('Close button not found')
      }

      commentNum++
    }

    const refreshSelector = 'a[href="/explore?channel_id=homefeed_recommend"]'
    try {
      await page.waitForSelector(refreshSelector)
      const refreshButton = await page.$(refreshSelector)
      if (refreshButton) {
        await refreshButton.click()
        await page.waitForSelector('#exploreFeeds .note-item', {
          timeout: 10000,
          visible: true,
        })
        await sleep(2000 * (0.5 + Math.random()))
      } else {
        console.log('Refresh button not found')
      }
    } catch (error) {
      console.error('Error during refresh:', error)
      return commentNum
    }

    return commentNum
  }
}

export enum XiaohongshuAgentTask {
  COMMENT = 'comment',
}

export interface CommentTaskOptions {
  limit: number
  llm: string
  keywords: string[]
  commentPrompt: string
}
