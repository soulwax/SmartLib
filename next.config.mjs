/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output when building for Electron.
  // The standalone bundle (.next/standalone/) is self-contained and can be
  // spawned as a child process by the Electron main process.
  output: process.env.BUILD_TARGET === 'electron' ? 'standalone' : undefined,
}

export default nextConfig
