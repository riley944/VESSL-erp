import './globals.css';

export const metadata = { title: 'Vessl — KUI Operations' };
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 5 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Fraunces is requested at 600 in eight places -- quotes.jsx crumbCurrent,
            title, clientName, clientAvatar, modalTitle and the Quotes header, plus
            .modal-head h3 and .qp-avatar in globals.css -- and this link loaded only
            400 and 500. A weight with no face loaded is SYNTHESISED: the browser
            dilates the 500 outlines to fake a bold. Fraunces is a high-contrast
            display serif, so the fake thickens its hairlines unevenly, and that is
            worst on all-caps strings where heavy vertical stems sit close together.
            "JOHNNIE-O" shows it; "BucketGolf" hides it in its lowercase curves.

            A RANGE, not three pinned instances: 400..700 is served as one variable
            file covering every weight the app asks for, including the 700 the print
            stylesheets import separately. The opsz axis is unchanged. */}
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Spline+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
