// ── A BUILT FILE, TO THE SHARE SHEET OR AS A DOWNLOAD ───────────────────────
// The iPad view (app/m) hands its exports to navigator.share({ files }) where
// the browser can share files -- iPad Safari opens the share sheet (Mail,
// Messages, Save to Files, AirDrop) -- and falls back to the desktop's
// download (lib/download.js) where it cannot.
//
// Returns what happened: 'shared', 'cancelled' (the sheet was closed),
// 'downloaded', or 'needs-tap'. Safari lets a page open the share sheet only
// inside the tap that asked for it, and building an Excel file can outlast
// that; then the share is refused (NotAllowedError) and the caller keeps the
// file and offers a "Share" button, whose own tap opens the sheet at once.
import { downloadBlob } from '@/lib/download';

export function canShareFile(file) {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch (e) {
    return false;
  }
}

export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      if (e && e.name === 'NotAllowedError') return 'needs-tap';
      // Anything else: the download still gets the file to the person.
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
