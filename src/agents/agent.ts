import type { Page } from 'puppeteer'
import type { BrowserOptions } from '../browser'
import { BrowserInstance } from '../browser'

export default class BaseAgent {
  private browser: BrowserInstance
  public page: Page | null = null

  constructor(browserConfig: BrowserOptions = {}) {
    this.browser = new BrowserInstance(browserConfig)
  }

  async setup(): Promise<void> {
    try {
      const browser = await this.browser.setup()
      console.log('Browser:', browser)
      this.page = await browser.newPage()
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error('Page not initialized')
    }
    return this.page
  }
}
