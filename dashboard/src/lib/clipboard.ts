// Robust clipboard copy that works on Mode A installs too.
//
// `navigator.clipboard` is only defined in a *secure context* (HTTPS or
// localhost). A Mode A install serves the dashboard over plain HTTP on a
// public IP, so `navigator.clipboard` is `undefined` there and every Copy
// button silently did nothing. Fall back to the legacy `execCommand('copy')`
// path, which works over plain HTTP.
export function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (err) {
      reject(err);
    }
  });
}
