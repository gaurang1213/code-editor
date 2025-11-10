// Note: using 'any' to allow experimental flags not present in local types
const nextConfig: any = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Note: allowedDevOrigins is a future Next.js option; remove to avoid warnings in current version
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  reactStrictMode:false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  
};

export default nextConfig as any;