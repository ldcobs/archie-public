import { redirect } from 'next/navigation';

// Legacy Keys / Users page — consolidated into Access Keys (/vpn-users).
// Kept as a redirect so old bookmarks/links still resolve. The NewKeyPanel
// component in this folder is still imported by the Access Keys page.
export default function KeysPage() {
  redirect('/vpn-users');
}
