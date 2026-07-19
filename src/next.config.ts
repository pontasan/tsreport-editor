import type { NextConfig } from "next";
import { resolve } from "node:path";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Single source of truth for the displayed app version: package.json. Inlined
  // into the bundle at build time so client components can read it.
  env: {
    APP_VERSION: pkg.version,
  },
  // Requests passing through proxy.ts (middleware) are limited to 10MB by default.
  // The editor-data import (tar.gz containing the whole NFS tree) can be much larger.
  experimental: {
    proxyClientMaxBodySize: '1gb',
  },
  
  turbopack: {},
  
  
  webpack: (config) => {
    config.resolve.modules = [
      resolve(process.cwd(), 'node_modules'),
      ...config.resolve.modules,
    ];
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
