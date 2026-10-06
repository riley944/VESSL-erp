import { useState, useEffect } from 'react';

// The Quotes page's phone switch: a viewport 720px wide or narrower. One
// definition, read by app/quotes.jsx and the Quote List tab, so the two halves of
// the page change layout at the same width.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth <= 720 : false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 720);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}
