/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // unpdf ships pdf.js as ESM (pdfjs.mjs); transpile so webpack emits valid chunks
  // (without this, Terser fails on nested `export` in the bundled output)
  transpilePackages: ['unpdf'],
  // @huggingface/transformers v3 ships onnxruntime-web's ESM `ort.bundle.min.mjs`
  // (uses `import.meta`) as a static asset. Next 14's default SWC minifier parses
  // emitted .mjs assets as scripts and fails with "'import.meta' cannot be used
  // outside of module code". Terser (module-aware for .mjs) handles it correctly.
  swcMinify: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector'],
  },
  webpack: (config) => {
    // Transformers.js: these Node-only packages must not be bundled for the browser
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      'onnxruntime-node$': false,
    };
    // onnxruntime-web's ESM bundle (ort.bundle.min.mjs) is emitted as a static
    // asset by transformers.js — webpack must not parse it (SWC chokes on it).
    config.module.noParse = [
      ...(config.module.noParse || []),
      /ort\.bundle\.min\.mjs$/,
    ];
    // Force the .mjs to stay a static asset (emitted file + URL) instead of
    // being inlined into a chunk where its top-level export breaks Terser.
    config.module.rules.push({
      test: /ort\.bundle\.min\.mjs$/,
      type: 'asset/resource',
    });
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};
export default nextConfig;
