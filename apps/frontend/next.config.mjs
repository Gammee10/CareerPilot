/** @type {import('next').NextConfig} */
const nextConfig = {
  // L6: standalone output — the runtime image ships only the prebuilt
  // server, no source and no node_modules install step.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    // Document-level hardening for the dashboard (H10). The API's own
    // headers are set by helmet in the backend; Caddy adds transport
    // headers at the edge. No custom CSP here: Next.js inline
    // scripts/hydration would break under a static script-src allowlist.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

export default nextConfig;
