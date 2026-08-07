/**
 * E2E tests for upload and download file features.
 *
 * Uses:
 *  - Upload: https://the-internet.herokuapp.com/upload
 *  - Download: local test server serving a downloadable file
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import net from 'node:net'
import {
  setupTestContext,
  cleanupTestContext,
  type TestContext,
} from './test-utils.js'
import './test-declarations.js'

const TEST_PORT = 19996

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal HTTP server that serves a page with a file input and a download link */
async function createTestFileServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const openSockets: Set<net.Socket> = new Set()

  const downloadContent = 'Hello from RunBrowser download test!'
  const downloadFilename = 'test-download.txt'

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html>
<html>
<head><title>Upload & Download Test</title></head>
<body>
  <h1>File Test Page</h1>
  <h2>Upload</h2>
  <form id="upload-form">
    <input type="file" id="file-input" />
    <div id="upload-result"></div>
  </form>
  <script>
    document.getElementById('file-input').addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        document.getElementById('upload-result').textContent = 'Selected: ' + file.name + ' (' + file.size + ' bytes)';
      }
    });
  </script>
  <h2>Download</h2>
  <a href="/download/${downloadFilename}" id="download-link">Download test file</a>
</body>
</html>`)
      return
    }

    if (req.url === `/download/${downloadFilename}`) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': Buffer.byteLength(downloadContent).toString(),
      })
      res.end(downloadContent)
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.on('connection', (socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to start test server')

  return {
    baseUrl: `http://127.0.0.1:${(address as net.AddressInfo).port}`,
    close: async () => {
      for (const socket of openSockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Upload & Download Tests', () => {
  let testCtx: TestContext | null = null
  let fileServer: Awaited<ReturnType<typeof createTestFileServer>> | null = null

  beforeAll(async () => {
    testCtx = await setupTestContext({
      port: TEST_PORT,
      tempDirPrefix: 'rb-upload-dl-test-',
      toggleExtension: true,
    })
    fileServer = await createTestFileServer()
  }, 600000)

  afterAll(async () => {
    await fileServer?.close()
    await cleanupTestContext(testCtx)
    testCtx = null
    fileServer = null
  })

  // =========================================================================
  // Upload
  // =========================================================================

  it('should upload a file to an <input type="file"> via REST API', async () => {
    const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

    // Create a session
    const sessionRes = await fetch(`${BASE_URL}/api/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(sessionRes.status).toBe(200)
    const { id: sessionId } = (await sessionRes.json()) as { id: string }

    // Navigate to test page
    const navRes = await fetch(`${BASE_URL}/api/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, url: fileServer!.baseUrl }),
    })
    expect(navRes.status).toBe(200)

    // Take snapshot to get refs
    const snapRes = await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    expect(snapRes.status).toBe(200)
    const snapData = (await snapRes.json()) as { snapshot: string }
    console.log('Snapshot:', snapData.snapshot)

    // The file input should have a ref — find it
    console.log('Upload page snapshot:', snapData.snapshot)
    // Look for the file input ref (button "Choose file" or similar)
    const fileInputRef = snapData.snapshot.match(/button ".*(?:file|Choose).*" (@e\d+)/i)?.[1]
      ?? snapData.snapshot.match(/(@e\d+)/)?.[1]
    expect(fileInputRef).toBeDefined()
    console.log('File input ref:', fileInputRef)

    // Create a temp file to upload
    const tempFile = path.join(os.tmpdir(), 'rb-test-upload.txt')
    fs.writeFileSync(tempFile, 'RunBrowser upload e2e test content')

    try {
      // Upload via /api/upload with file path (local mode)
      const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          ref: fileInputRef,
          files: [tempFile],
        }),
      })
      expect(uploadRes.status).toBe(200)
      const uploadData = (await uploadRes.json()) as { success: boolean }
      expect(uploadData.success).toBe(true)

      // Verify the file was selected by checking the page
      const evalRes = await fetch(`${BASE_URL}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          code: 'document.getElementById("upload-result").textContent',
        }),
      })
      expect(evalRes.status).toBe(200)
      const evalData = (await evalRes.json()) as { text: string }
      console.log('Upload result text:', evalData.text)
      expect(evalData.text).toContain('rb-test-upload.txt')
    } finally {
      fs.unlinkSync(tempFile)
    }

    // Cleanup session
    await fetch(`${BASE_URL}/api/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  }, 30000)

  // =========================================================================
  // Upload with base64 (remote mode)
  // =========================================================================

  it('should upload a file via base64 fileData (remote mode)', async () => {
    const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

    const sessionRes = await fetch(`${BASE_URL}/api/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const { id: sessionId } = (await sessionRes.json()) as { id: string }

    await fetch(`${BASE_URL}/api/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, url: fileServer!.baseUrl }),
    })

    // Get snapshot to find the file input ref
    const snapRes = await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const snapData = (await snapRes.json()) as { snapshot: string }
    console.log('Base64 upload snapshot:', snapData.snapshot)
    const fileInputRef = snapData.snapshot.match(/button ".*(?:file|Choose).*" (@e\d+)/i)?.[1]
      ?? snapData.snapshot.match(/(@e\d+)/)?.[1]
    expect(fileInputRef).toBeDefined()

    // Upload via base64 fileData (simulates remote mode)
    const fileContent = 'Base64 upload test content'
    const uploadRes = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        ref: fileInputRef,
        fileData: [
          {
            name: 'remote-upload.txt',
            data: Buffer.from(fileContent).toString('base64'),
          },
        ],
      }),
    })
    expect(uploadRes.status).toBe(200)
    const uploadData = (await uploadRes.json()) as { success: boolean }
    expect(uploadData.success).toBe(true)

    // Verify
    const evalRes = await fetch(`${BASE_URL}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        code: 'document.getElementById("upload-result").textContent',
      }),
    })
    const evalData = (await evalRes.json()) as { text: string }
    console.log('Base64 upload result:', evalData.text)
    expect(evalData.text).toContain('remote-upload.txt')

    await fetch(`${BASE_URL}/api/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  }, 30000)

  // =========================================================================
  // Download by clicking a link
  // =========================================================================

  it('should download a file by clicking a ref', async () => {
    const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

    const sessionRes = await fetch(`${BASE_URL}/api/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const { id: sessionId } = (await sessionRes.json()) as { id: string }

    await fetch(`${BASE_URL}/api/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, url: fileServer!.baseUrl }),
    })

    // Snapshot to get refs
    const snapRes = await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const snapData = (await snapRes.json()) as { snapshot: string }
    console.log('Download page snapshot:', snapData.snapshot)

    // Find the download link ref (should be @e2 or similar)
    // The link text is "Download test file"
    const linkRefMatch = snapData.snapshot.match(/link "Download test file" (@e\d+)/)
    expect(linkRefMatch).not.toBeNull()
    const downloadRef = linkRefMatch![1]
    console.log('Download link ref:', downloadRef)

    // Download via /api/download
    const downloadRes = await fetch(`${BASE_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        ref: downloadRef,
        timeout: 15000,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const downloadBody = await downloadRes.text()
    console.log('Download response status:', downloadRes.status, 'body:', downloadBody)
    expect(downloadRes.status).toBe(200)
    const downloadData = JSON.parse(downloadBody) as {
      suggestedFilename: string
      data: string
      totalBytes: number
    }

    console.log('Downloaded:', downloadData.suggestedFilename, downloadData.totalBytes, 'bytes')

    expect(downloadData.suggestedFilename).toBe('test-download.txt')
    expect(downloadData.totalBytes).toBeGreaterThan(0)

    // Decode and verify content
    const content = Buffer.from(downloadData.data, 'base64').toString('utf-8')
    expect(content).toBe('Hello from RunBrowser download test!')

    await fetch(`${BASE_URL}/api/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  }, 30000)

  // =========================================================================
  // Download by URL
  // =========================================================================

  it('should download a file by URL', async () => {
    const BASE_URL = `http://127.0.0.1:${TEST_PORT}`

    const sessionRes = await fetch(`${BASE_URL}/api/session/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const { id: sessionId } = (await sessionRes.json()) as { id: string }

    // Navigate to any page first (download needs a page context)
    await fetch(`${BASE_URL}/api/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, url: fileServer!.baseUrl }),
    })

    // Download by URL
    const downloadUrl = `${fileServer!.baseUrl}/download/test-download.txt`
    const downloadRes = await fetch(`${BASE_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        url: downloadUrl,
        timeout: 15000,
      }),
      signal: AbortSignal.timeout(25000),
    })
    const downloadBody = await downloadRes.text()
    console.log('URL download response status:', downloadRes.status, 'body:', downloadBody.slice(0, 500))
    expect(downloadRes.status).toBe(200)
    const downloadData = JSON.parse(downloadBody) as {
      suggestedFilename: string
      data: string
      totalBytes: number
    }

    console.log('URL download:', downloadData.suggestedFilename, downloadData.totalBytes, 'bytes')

    expect(downloadData.totalBytes).toBeGreaterThan(0)
    const content = Buffer.from(downloadData.data, 'base64').toString('utf-8')
    expect(content).toBe('Hello from RunBrowser download test!')

    await fetch(`${BASE_URL}/api/session/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  }, 30000)
})
