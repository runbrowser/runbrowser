import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ScopedFS } from '@jiweiyuan/runbrowser-core'

function withTempSandbox(
  fn: (paths: {
    root: string
    allowedDir: string
    outsideDir: string
  }) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-fs-'))
  const allowedDir = path.join(root, 'allowed')
  const outsideDir = path.join(root, 'outside')

  fs.mkdirSync(allowedDir)
  fs.mkdirSync(outsideDir)

  try {
    fn({ root, allowedDir, outsideDir })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('ScopedFS', () => {
  it('blocks reads through symlinks that escape allowed directories', () => {
    withTempSandbox(({ allowedDir, outsideDir }) => {
      const secretPath = path.join(outsideDir, 'secret.txt')
      fs.writeFileSync(secretPath, 'top secret', 'utf8')
      fs.symlinkSync(outsideDir, path.join(allowedDir, 'outside-link'))

      const scopedFs = new ScopedFS([allowedDir])

      expect(() =>
        scopedFs.readFileSync(path.join(allowedDir, 'outside-link', 'secret.txt'), 'utf8'),
      ).toThrow(/EPERM/)
    })
  })

  it('allows reads through symlinks that stay inside allowed directories', () => {
    withTempSandbox(({ allowedDir }) => {
      const contentPath = path.join(allowedDir, 'note.txt')
      fs.writeFileSync(contentPath, 'hello', 'utf8')
      fs.symlinkSync('./note.txt', path.join(allowedDir, 'note-link.txt'))

      const scopedFs = new ScopedFS([allowedDir])
      const content = scopedFs.readFileSync(path.join(allowedDir, 'note-link.txt'), 'utf8')

      expect(content).toBe('hello')
    })
  })

  it('blocks creating symlinks whose targets resolve outside allowed directories', () => {
    withTempSandbox(({ allowedDir, outsideDir }) => {
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret', 'utf8')
      const scopedFs = new ScopedFS([allowedDir])

      expect(() => scopedFs.symlinkSync('../outside/secret.txt', path.join(allowedDir, 'bad-link.txt'))).toThrow(
        /EPERM/,
      )
    })
  })
})
