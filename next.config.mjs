/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev server only (GHSA-3h52). Setting this at all switches Next from warning
  // to BLOCKING cross-origin requests for /_next/* resources, so another site
  // open in the browser cannot read the dev build. Hostnames, not origins;
  // localhost is allowed by Next regardless and is listed here to be explicit.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // `npm run build` writes to .next-build (NEXT_DIST_DIR, set by the build
  // script), so a production build can run while the dev server keeps .next.
  // Anything that does not set it -- next dev -- keeps the default.
  // On Vercel always .next, whatever the build script sets -- the platform reads it there.
  distDir: process.env.VERCEL ? '.next' : (process.env.NEXT_DIST_DIR || '.next'),
};
export default nextConfig;
