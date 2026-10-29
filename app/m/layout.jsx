// ── /m: THE IPAD VIEW ───────────────────────────────────────────────────────
// A light, touch-first view of the app for Riley's iPad (portrait ~820px,
// landscape ~1180px; usable on a phone). Only this route links the web app
// manifest and the home-screen icons, so "Add to Home Screen" from /m opens
// /m standalone; the desktop pages get none of it.
export const metadata = {
  title: 'VESSL',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'VESSL', statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

// viewport-fit=cover so the view can pad itself clear of the notch and the
// home indicator (env(safe-area-inset-*)); pinch zoom stays allowed.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#0f1729',
};

export default function MLayout({ children }) {
  return children;
}
