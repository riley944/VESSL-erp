/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev server only (GHSA-3h52). Setting this at all switches Next from warning
  // to BLOCKING cross-origin requests for /_next/* resources, so another site
  // open in the browser cannot read the dev build. Hostnames, not origins;
  // localhost is allowed by Next regardless and is listed here to be explicit.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
};
export default nextConfig;
