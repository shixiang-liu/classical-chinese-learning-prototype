import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
}

export default nextConfig
