import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

export default (phase: string): NextConfig => ({
  reactStrictMode: true,
  // Keep `next dev` bundles separate from production builds. Otherwise a
  // build can replace chunks while an open dev server is still serving them.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
})
