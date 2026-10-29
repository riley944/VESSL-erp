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

export function canShareFiles(files) {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch (e) {
    return false;
  }
}
export const canShareFile = (file) => canShareFiles([file]);

// Several files at once -- a record's CSV is one file per table -- in one share
// sheet; the fallback downloads them one after another, 400ms apart, as the
// desktop does. files: [{ blob, name }].
export async function shareFiles(files) {
  const list = (files || []).map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  if (list.length && canShareFiles(list)) {
    try {
      await navigator.share({ files: list, title: list.length === 1 ? list[0].name : list.length + ' files' });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      if (e && e.name === 'NotAllowedError') return 'needs-tap';
      // Anything else: the download still gets the files to the person.
    }
  }
  for (let i = 0; i < (files || []).length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400));
    downloadBlob(files[i].blob, files[i].name);
  }
  return 'downloaded';
}

export const shareOrDownload = (blob, filename) => shareFiles([{ blob, name: filename }]);
