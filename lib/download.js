// A built file, handed to the browser as a download. Moved from app/quotes.jsx
// (Send to Client) so the iPad view falls back to the same download when it
// cannot open the share sheet.
export const downloadBlob = (blob, filename) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
