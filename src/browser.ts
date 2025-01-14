import type { Buffer } from 'node:buffer'
import type { Browser } from 'puppeteer'
import { spawn } from 'node:child_process'
import axios from 'axios'
import puppeteer from 'puppeteer'
import { PuppeteerExtra } from 'puppeteer-extra'

export interface BrowserOptions {
  chromePath?: string
  defaultViewport?: {
    width: number
    height: number
  }
}

export class BrowserInstance {
  private browserOptions: BrowserOptions
  private browser: Browser | null = null

  constructor(options: BrowserOptions = {}) {
    this.browserOptions = options
  }

  private async launchChromeProcess(): Promise<void> {
    console.log('Launching a Chrome Instance...')
    const CHROME_STARTUP_TIMEOUT = 10000
    return new Promise((resolve, reject) => {
      const chrome = spawn(this.browserOptions.chromePath || '', [
        '--remote-debugging-port=9222',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ])

      let isResolved = false

      chrome.stderr.on('data', (data: Buffer) => {
        if (data.toString().includes('DevTools listening')) {
          isResolved = true
          resolve()
        }
      })

      chrome.on('error', (error: Error) => {
        if (!isResolved) {
          reject(new Error(`Failed to start Chrome: ${error.message}`))
        }
      })

      setTimeout(() => {
        if (!isResolved) {
          chrome.kill()
          reject(new Error(`Chrome startup timed out after ${CHROME_STARTUP_TIMEOUT}ms`))
        }
      }, CHROME_STARTUP_TIMEOUT)
    })
  }

  async isRunning(): Promise<boolean> {
    try {
      const response = await axios.get('http://localhost:9222/json/version', { timeout: 1000 })
      return response.status === 200
    } catch (error) {
      console.error('Error:', error)
      return false
    }
  }

  async setup(): Promise<Browser> {
    if (this.browser) {
      return this.browser
    }

    const isChromeRunning = await this.isRunning()
    if (isChromeRunning) {
      console.log('Connecting to an existing Chrome Instance...')
      const browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: this.browserOptions.defaultViewport,
      })

      this.browser = browser
      return browser
    }

    if (this.browserOptions.chromePath) {
      try {
        await this.launchChromeProcess()
        const browser = await puppeteer.connect({
          browserURL: 'http://localhost:9222',
          defaultViewport: this.browserOptions.defaultViewport,
        })
        this.browser = browser
        return browser
      } catch (error) {
        console.error('Failed to start a New Chrome:', error)
        throw error
      }
    }

    try {
      const puppeteerExtra = new PuppeteerExtra(puppeteer)

      const launchOptions = {
        headless: false, // Change to false to see the browser
        slowMo: 100, // Slows down operations by 100ms
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=1920,1080', // Set window size
          '--remote-debugging-port=9222',
          '--start-maximized', // Start with maximized window
        ],
        defaultViewport: this.browserOptions.defaultViewport,
      }
      const browser = await puppeteerExtra.launch(launchOptions)
      this.browser = browser
      return browser
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.disconnect()
      this.browser = null
    }
  }
}
