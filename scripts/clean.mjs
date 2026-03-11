#!/usr/bin/env node
/**
 * Cross-platform clean script.
 *
 * On Windows, `.next/standalone/node_modules` contains directory junctions
 * that Node's fs.unlink / rimraf cannot remove (EPERM). Windows' native
 * `rd /s /q` handles junctions correctly, so we shell out to it on win32.
 */
import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const DIRS = ['.next', 'dist-electron', 'dist']

for (const dir of DIRS) {
  if (!existsSync(dir)) continue

  try {
    if (process.platform === 'win32') {
      execSync(`cmd /c rd /s /q "${dir}"`, { stdio: 'ignore' })
    } else {
      rmSync(dir, { recursive: true, force: true })
    }
    console.log(`cleaned ${dir}`)
  } catch (err) {
    console.error(`failed to clean ${dir}: ${err.message}`)
    process.exit(1)
  }
}
