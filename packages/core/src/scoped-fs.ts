import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

/**
 * A sandboxed fs wrapper that restricts all file operations to allowed directories.
 * Any attempt to access files outside the allowed directories will throw an EPERM error.
 *
 * By default, allows access to:
 * - Current working directory (process.cwd())
 * - /tmp
 * - os.tmpdir()
 *
 * This is used in the MCP VM context to prevent agents from accessing sensitive system files.
 */
export class ScopedFS {
  private allowedDirs: string[]

  constructor(allowedDirs?: string[]) {
    // Default allowed directories: cwd, /tmp, os.tmpdir()
    const defaultDirs = [process.cwd(), '/tmp', os.tmpdir()]

    // Use provided dirs or defaults, resolve all to absolute paths
    const dirs = allowedDirs ?? defaultDirs
    this.allowedDirs = [...new Set(dirs.map((d) => this.resolveToBoundaryPath(path.resolve(d))))]
  }

  /**
   * Check if a resolved path is within any of the allowed directories.
   */
  private isPathAllowed(resolved: string): boolean {
    return this.allowedDirs.some((dir) => {
      return resolved === dir || resolved.startsWith(dir + path.sep)
    })
  }

  /**
   * Resolve a path and ensure it stays within allowed directories.
   * Throws EPERM if the resolved path escapes the sandbox.
   */
  private toPathString(filePath: fs.PathLike | number): string {
    if (typeof filePath === 'number') {
      throw new TypeError('ScopedFS does not support file descriptor inputs')
    }
    if (filePath instanceof URL) {
      return fileURLToPath(filePath)
    }
    return Buffer.isBuffer(filePath) ? filePath.toString() : String(filePath)
  }

  /**
   * Resolve path through real filesystem ancestors to prevent symlink traversal.
   * If the final path does not exist yet, this resolves the nearest existing ancestor
   * and appends the remaining segments.
   */
  private resolveToBoundaryPath(resolvedPath: string): string {
    let current = resolvedPath
    const suffixSegments: string[] = []

    while (true) {
      try {
        const realCurrent = fs.realpathSync.native(current)
        return suffixSegments.length > 0 ? path.join(realCurrent, ...suffixSegments.reverse()) : realCurrent
      } catch (error) {
        const errno = error as NodeJS.ErrnoException
        if (errno.code !== 'ENOENT') {
          throw error
        }
        const parent = path.dirname(current)
        if (parent === current) {
          return resolvedPath
        }
        suffixSegments.push(path.basename(current))
        current = parent
      }
    }
  }

  private resolvePath(filePath: fs.PathLike | number): string {
    const pathString = this.toPathString(filePath)
    const resolved = path.resolve(pathString)
    const boundaryResolved = this.resolveToBoundaryPath(resolved)

    if (!this.isPathAllowed(boundaryResolved)) {
      const error = new Error(
        `EPERM: operation not permitted, access outside allowed directories: ${pathString}`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      error.errno = -1
      error.syscall = 'access'
      error.path = pathString
      throw error
    }
    return resolved
  }

  // Sync methods

  readFileSync = (filePath: fs.PathOrFileDescriptor, options?: any): any => {
    const resolved = this.resolvePath(filePath)
    return fs.readFileSync(resolved, options)
  }

  writeFileSync = (filePath: fs.PathOrFileDescriptor, data: any, options?: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.writeFileSync(resolved, data, options)
  }

  appendFileSync = (filePath: fs.PathOrFileDescriptor, data: any, options?: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.appendFileSync(resolved, data, options)
  }

  readdirSync = (dirPath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(dirPath)
    return fs.readdirSync(resolved, options)
  }

  mkdirSync = (dirPath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(dirPath)
    return fs.mkdirSync(resolved, options)
  }

  rmdirSync = (dirPath: fs.PathLike, options?: any): void => {
    const resolved = this.resolvePath(dirPath)
    fs.rmdirSync(resolved, options)
  }

  unlinkSync = (filePath: fs.PathLike): void => {
    const resolved = this.resolvePath(filePath)
    fs.unlinkSync(resolved)
  }

  statSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath)
    return fs.statSync(resolved, options)
  }

  lstatSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath)
    return fs.lstatSync(resolved, options)
  }

  existsSync = (filePath: fs.PathLike): boolean => {
    try {
      const resolved = this.resolvePath(filePath)
      return fs.existsSync(resolved)
    } catch {
      return false
    }
  }

  accessSync = (filePath: fs.PathLike, mode?: number): void => {
    const resolved = this.resolvePath(filePath)
    fs.accessSync(resolved, mode)
  }

  copyFileSync = (src: fs.PathLike, dest: fs.PathLike, mode?: number): void => {
    const resolvedSrc = this.resolvePath(src)
    const resolvedDest = this.resolvePath(dest)
    fs.copyFileSync(resolvedSrc, resolvedDest, mode)
  }

  renameSync = (oldPath: fs.PathLike, newPath: fs.PathLike): void => {
    const resolvedOld = this.resolvePath(oldPath)
    const resolvedNew = this.resolvePath(newPath)
    fs.renameSync(resolvedOld, resolvedNew)
  }

  chmodSync = (filePath: fs.PathLike, mode: fs.Mode): void => {
    const resolved = this.resolvePath(filePath)
    fs.chmodSync(resolved, mode)
  }

  chownSync = (filePath: fs.PathLike, uid: number, gid: number): void => {
    const resolved = this.resolvePath(filePath)
    fs.chownSync(resolved, uid, gid)
  }

  utimesSync = (filePath: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike): void => {
    const resolved = this.resolvePath(filePath)
    fs.utimesSync(resolved, atime, mtime)
  }

  realpathSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath)
    const real = fs.realpathSync(resolved, options)
    // Verify the real path is also within allowed directories (handles symlinks)
    const realStr = real.toString()
    if (!this.isPathAllowed(realStr)) {
      const error = new Error(
        `EPERM: operation not permitted, realpath escapes allowed directories`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    return real
  }

  readlinkSync = (filePath: fs.PathLike, options?: any): any => {
    const resolved = this.resolvePath(filePath)
    return fs.readlinkSync(resolved, options)
  }

  symlinkSync = (target: fs.PathLike, linkPath: fs.PathLike, type?: fs.symlink.Type | null): void => {
    const resolvedLink = this.resolvePath(linkPath)
    // Target is relative to link location, resolve against canonical link directory.
    const linkDir = this.resolveToBoundaryPath(path.dirname(resolvedLink))
    const targetPath = this.toPathString(target)
    const resolvedTarget = path.isAbsolute(targetPath) ? targetPath : path.resolve(linkDir, targetPath)
    const boundaryResolvedTarget = this.resolveToBoundaryPath(resolvedTarget)
    if (!this.isPathAllowed(boundaryResolvedTarget)) {
      const error = new Error(
        `EPERM: operation not permitted, symlink target outside allowed directories`,
      ) as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    }
    fs.symlinkSync(target, resolvedLink, type)
  }

  rmSync = (filePath: fs.PathLike, options?: fs.RmOptions): void => {
    const resolved = this.resolvePath(filePath)
    fs.rmSync(resolved, options)
  }

  // Async callback methods

  readFile = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.readFile as any)(resolved, ...args)
  }

  writeFile = (filePath: any, data: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.writeFile as any)(resolved, data, ...args)
  }

  appendFile = (filePath: any, data: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.appendFile as any)(resolved, data, ...args)
  }

  readdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath)
    ;(fs.readdir as any)(resolved, ...args)
  }

  mkdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath)
    ;(fs.mkdir as any)(resolved, ...args)
  }

  rmdir = (dirPath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(dirPath)
    ;(fs.rmdir as any)(resolved, ...args)
  }

  unlink = (filePath: any, callback: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.unlink(resolved, callback)
  }

  stat = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.stat as any)(resolved, ...args)
  }

  lstat = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.lstat as any)(resolved, ...args)
  }

  access = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.access as any)(resolved, ...args)
  }

  copyFile = (src: any, dest: any, ...args: any[]): void => {
    const resolvedSrc = this.resolvePath(src)
    const resolvedDest = this.resolvePath(dest)
    ;(fs.copyFile as any)(resolvedSrc, resolvedDest, ...args)
  }

  rename = (oldPath: any, newPath: any, callback: any): void => {
    const resolvedOld = this.resolvePath(oldPath)
    const resolvedNew = this.resolvePath(newPath)
    fs.rename(resolvedOld, resolvedNew, callback)
  }

  chmod = (filePath: any, mode: any, callback: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.chmod(resolved, mode, callback)
  }

  chown = (filePath: any, uid: any, gid: any, callback: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.chown(resolved, uid, gid, callback)
  }

  rm = (filePath: any, ...args: any[]): void => {
    const resolved = this.resolvePath(filePath)
    ;(fs.rm as any)(resolved, ...args)
  }

  exists = (filePath: any, callback: any): void => {
    try {
      const resolved = this.resolvePath(filePath)
      fs.exists(resolved, callback)
    } catch {
      callback(false)
    }
  }

  // Stream methods

  createReadStream = (filePath: fs.PathLike, options?: any): fs.ReadStream => {
    const resolved = this.resolvePath(filePath)
    return fs.createReadStream(resolved, options)
  }

  createWriteStream = (filePath: fs.PathLike, options?: any): fs.WriteStream => {
    const resolved = this.resolvePath(filePath)
    return fs.createWriteStream(resolved, options)
  }

  // Watch methods

  watch = (filePath: any, ...args: any[]): fs.FSWatcher => {
    const resolved = this.resolvePath(filePath)
    return (fs.watch as any)(resolved, ...args)
  }

  watchFile = (filePath: any, ...args: any[]): fs.StatWatcher => {
    const resolved = this.resolvePath(filePath)
    return (fs.watchFile as any)(resolved, ...args)
  }

  unwatchFile = (filePath: any, listener?: any): void => {
    const resolved = this.resolvePath(filePath)
    fs.unwatchFile(resolved, listener)
  }

  // Promise-based API (fs.promises equivalent)
  get promises() {
    const self = this
    return {
      readFile: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.readFile(resolved, options)
      },
      writeFile: async (filePath: fs.PathLike, data: any, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.writeFile(resolved, data, options)
      },
      appendFile: async (filePath: fs.PathLike, data: any, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.appendFile(resolved, data, options)
      },
      readdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath)
        return fs.promises.readdir(resolved, options)
      },
      mkdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath)
        return fs.promises.mkdir(resolved, options)
      },
      rmdir: async (dirPath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(dirPath)
        return fs.promises.rmdir(resolved, options)
      },
      unlink: async (filePath: fs.PathLike) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.unlink(resolved)
      },
      stat: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.stat(resolved, options)
      },
      lstat: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.lstat(resolved, options)
      },
      access: async (filePath: fs.PathLike, mode?: number) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.access(resolved, mode)
      },
      copyFile: async (src: fs.PathLike, dest: fs.PathLike, mode?: number) => {
        const resolved = self.resolvePath(src)
        const resolvedDest = self.resolvePath(dest)
        return fs.promises.copyFile(resolved, resolvedDest, mode)
      },
      rename: async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
        const resolvedOld = self.resolvePath(oldPath)
        const resolvedNew = self.resolvePath(newPath)
        return fs.promises.rename(resolvedOld, resolvedNew)
      },
      chmod: async (filePath: fs.PathLike, mode: fs.Mode) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.chmod(resolved, mode)
      },
      chown: async (filePath: fs.PathLike, uid: number, gid: number) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.chown(resolved, uid, gid)
      },
      rm: async (filePath: fs.PathLike, options?: fs.RmOptions) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.rm(resolved, options)
      },
      realpath: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath)
        const real = await fs.promises.realpath(resolved, options)
        const realStr = real.toString()
        if (!self.isPathAllowed(realStr)) {
          const error = new Error(
            `EPERM: operation not permitted, realpath escapes allowed directories`,
          ) as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        return real
      },
      readlink: async (filePath: fs.PathLike, options?: any) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.readlink(resolved, options)
      },
      symlink: async (target: fs.PathLike, linkPath: fs.PathLike, type?: string) => {
        const resolvedLink = self.resolvePath(linkPath)
        const linkDir = self.resolveToBoundaryPath(path.dirname(resolvedLink))
        const targetPath = self.toPathString(target)
        const resolvedTarget = path.isAbsolute(targetPath) ? targetPath : path.resolve(linkDir, targetPath)
        const boundaryResolvedTarget = self.resolveToBoundaryPath(resolvedTarget)
        if (!self.isPathAllowed(boundaryResolvedTarget)) {
          const error = new Error(
            `EPERM: operation not permitted, symlink target outside allowed directories`,
          ) as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        return fs.promises.symlink(target, resolvedLink, type as any)
      },
      utimes: async (filePath: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike) => {
        const resolved = self.resolvePath(filePath)
        return fs.promises.utimes(resolved, atime, mtime)
      },
    }
  }

  // Constants passthrough
  constants = fs.constants
}

