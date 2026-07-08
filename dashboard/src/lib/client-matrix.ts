// Single source of truth: VPN client × protocol × platform compatibility matrix,
// enriched with per-OS install steps, app-store availability by country, and
// operator flags. BOTH the VPN Clients page and the invite/onboarding page derive
// from this — there is no separate hardcoded list anywhere else.
//
// Support tiers: 'full' = works out of the box, 'partial' = works with config,
// 'no' = not supported, 'unknown' = untested.

export type SupportTier = 'full' | 'partial' | 'no' | 'unknown';
export type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'linux';

// App-store availability by region (informational — NEVER used to block a user;
// a user on another country's Apple account can still install its apps). Verified
// via apps.apple.com/{country}/app/.../id{id} loading.
export type Availability = 'available' | 'removed' | 'check' | 'unknown';

// What the client imports: a subscription URL, a single share config (vless://…),
// or a downloadable WireGuard .conf.
export type ImportMode = 'subscription' | 'direct' | 'wireguard';

// Loose grouping used to organize the matrix and bias recommendations.
export type ClientCategory = 'modern' | 'vless-vmess' | 'wireguard' | 'clash-singbox';

export interface InstallStep { title: string; desc: string; }
export interface PlatformInstall { app: string; appUrl: string; steps: InstallStep[]; }

export interface ClientEntry {
  id: string;
  name: string;
  category: ClientCategory;
  platforms: Platform[];
  url: string;
  protocols: Record<string, SupportTier>;
  notes?: Partial<Record<string, string>>;        // per-protocol note
  importMode: ImportMode;
  deepLink?: string;                               // $URL replaced with encoded share link
  recommended?: boolean;                           // bias to top of the invite picker
  showInInvite?: boolean;                          // appears in the onboarding picker (default true)
  availability?: Partial<Record<string, Availability>>; // region key → status (e.g. { regional: 'available' })
  install?: Partial<Record<Platform, PlatformInstall>>; // per-OS app + store URL + steps
}

// Protocol keys that appear in the matrix (subset relevant to end-users)
export const MATRIX_PROTOCOLS: string[] = [
  'vless-reality',
  'vmess-ws-tls',
  'vmess-grpc-tls',
  'vless-ws-tls',
  'vless-grpc-tls',
  'trojan-tls',
  'trojan-ws-tls',
  'shadowsocks',
  'hysteria2',
  'wireguard',
  'vless-xhttp-tls',
  'vmess-xhttp-tls',
  'vless-httpupgrade',
  'vmess-httpupgrade',
];

// Shorthand protocol maps to keep entries readable.
const ALL_XRAY: Record<string, SupportTier> = {
  'vless-reality': 'full', 'vmess-ws-tls': 'full', 'vmess-grpc-tls': 'full',
  'vless-ws-tls': 'full', 'vless-grpc-tls': 'full', 'trojan-tls': 'full',
  'trojan-ws-tls': 'full', 'shadowsocks': 'full', 'hysteria2': 'full',
  'wireguard': 'no', 'vless-xhttp-tls': 'full', 'vmess-xhttp-tls': 'full',
  'vless-httpupgrade': 'full', 'vmess-httpupgrade': 'full',
};
const NONE: Record<string, SupportTier> = Object.fromEntries(MATRIX_PROTOCOLS.map(p => [p, 'no']));
const WG_ONLY: Record<string, SupportTier> = { ...NONE, wireguard: 'full' };

export const CLIENT_MATRIX: ClientEntry[] = [
  {
    id: 'hiddify',
    name: 'Hiddify',
    category: 'modern',
    platforms: ['ios', 'android', 'windows', 'mac', 'linux'],
    url: 'https://hiddify.com',
    importMode: 'subscription',
    deepLink: 'hiddify://install-sub?url=$URL',
    recommended: true,
    availability: { regional: 'check' },
    protocols: { ...ALL_XRAY, wireguard: 'full' },
    install: {
      ios:     { app: 'Hiddify', appUrl: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532', steps: [
        { title: 'Install Hiddify from the App Store.',              desc: 'Search for "Hiddify" and install the official app.' },
        { title: 'Open the app and tap Add Profile.',                desc: 'Tap the + icon or "Add Profile" to add a new connection.' },
        { title: 'Scan the QR code or paste the subscription link.', desc: 'Use the QR code on the left or paste the link you copied.' },
        { title: 'Connect and verify your status is Active.',        desc: 'Tap Connect and ensure your status shows Active.' },
      ]},
      android: { app: 'Hiddify', appUrl: 'https://play.google.com/store/apps/details?id=app.hiddify.com', steps: [
        { title: 'Install Hiddify from Google Play.',                desc: 'Search for "Hiddify" and install the official app.' },
        { title: 'Open the app and tap Add Profile.',                desc: 'Tap the + icon to add a new connection profile.' },
        { title: 'Scan the QR code or paste the subscription link.', desc: 'Use the QR code on the left or paste the link you copied.' },
        { title: 'Tap Connect and verify the connection.',           desc: 'Ensure your status shows Active once connected.' },
      ]},
      windows: { app: 'Hiddify', appUrl: 'https://github.com/hiddify/hiddify-app/releases/latest', steps: [
        { title: 'Download and install Hiddify.',                    desc: 'Get the latest release from GitHub and run the installer.' },
        { title: 'Click + → Add Profile.',                           desc: 'Use the add button to import a profile.' },
        { title: 'Paste the subscription link or scan the QR code.', desc: 'You can also drag the QR image into the window.' },
        { title: 'Click the profile to connect.',                    desc: 'Select your profile and click Connect to activate.' },
      ]},
      mac:     { app: 'Hiddify', appUrl: 'https://apps.apple.com/app/hiddify/id6596777532', steps: [
        { title: 'Install Hiddify from the Mac App Store.',          desc: 'Or download the latest release from GitHub.' },
        { title: 'Click + → Add Profile.',                           desc: 'Use the add button to import a profile.' },
        { title: 'Paste the subscription link and click Add.',       desc: 'Or drag the QR image into the app window.' },
        { title: 'Select the profile and click Connect.',            desc: 'Your VPN connection is now active.' },
      ]},
      linux:   { app: 'Hiddify', appUrl: 'https://github.com/hiddify/hiddify-app/releases/latest', steps: [
        { title: 'Download the AppImage from GitHub.',               desc: 'Make it executable: chmod +x Hiddify.AppImage' },
        { title: 'Run the app and click + → Add Profile.',           desc: 'Use the add button to import a connection profile.' },
        { title: 'Paste the subscription link and click Add.',       desc: 'Or drag the QR image into the app window.' },
        { title: 'Select the profile and click Connect.',            desc: 'Your VPN connection is now active.' },
      ]},
    },
  },
  {
    id: 'avovpn',
    name: 'avoVPN',
    category: 'vless-vmess',
    platforms: ['ios'],
    url: 'https://apps.apple.com/app/avovpn/id6670333179',
    importMode: 'subscription',
    recommended: true,
    // Currently listed in some regions' App Stores; advertises VLESS/VMess key import.
    availability: { regional: 'available' },
    protocols: { ...NONE,
      'vless-reality': 'full', 'vmess-ws-tls': 'full', 'vless-ws-tls': 'full',
      'vmess-grpc-tls': 'full', 'vless-grpc-tls': 'full', 'trojan-tls': 'partial',
      'trojan-ws-tls': 'partial', 'shadowsocks': 'full',
    },
    install: {
      ios: { app: 'avoVPN', appUrl: 'https://apps.apple.com/app/avovpn/id6670333179', steps: [
        { title: 'Install avoVPN from the App Store.',               desc: 'Available in many regions, including regional App Stores.' },
        { title: 'Tap + → Import from subscription / link.',         desc: 'Paste the subscription link or scan the QR code on the left.' },
        { title: 'Confirm the import.',                              desc: 'Your servers appear in the list.' },
        { title: 'Select a server and tap Connect.',                 desc: 'Grant VPN permissions if prompted.' },
      ]},
    },
  },
  {
    id: 'amnezia',
    name: 'Amnezia VPN',
    category: 'modern',
    platforms: ['ios', 'android', 'windows', 'mac', 'linux'],
    url: 'https://amnezia.org',
    importMode: 'direct',
    availability: { regional: 'available' },
    protocols: {
      'vless-reality': 'full', 'vmess-ws-tls': 'full', 'vmess-grpc-tls': 'partial',
      'vless-ws-tls': 'full', 'vless-grpc-tls': 'partial', 'trojan-tls': 'full',
      'trojan-ws-tls': 'full', 'shadowsocks': 'full', 'hysteria2': 'no',
      'wireguard': 'full', 'vless-xhttp-tls': 'unknown', 'vmess-xhttp-tls': 'unknown',
      'vless-httpupgrade': 'unknown', 'vmess-httpupgrade': 'unknown',
    },
    notes: {
      'vmess-grpc-tls': 'gRPC requires enabling in app settings',
      'vless-grpc-tls': 'gRPC requires enabling in app settings',
    },
    install: {
      ios:     { app: 'Amnezia VPN', appUrl: 'https://apps.apple.com/app/amneziavpn/id1600529900', steps: [
        { title: 'Install Amnezia VPN from the App Store.',          desc: 'Search for "Amnezia VPN" and install the app.' },
        { title: 'Tap "Add connection" → "From QR code".',           desc: 'Or use "From link" and paste the VPN link (vless://…).' },
        { title: 'Scan the QR code on the left.',                    desc: 'The app will import your configuration automatically.' },
        { title: 'Tap Connect to activate.',                         desc: 'Your VPN is now active.' },
      ]},
      android: { app: 'Amnezia VPN', appUrl: 'https://play.google.com/store/apps/details?id=org.amnezia.vpn', steps: [
        { title: 'Install Amnezia VPN from Google Play.',            desc: 'Search for "Amnezia VPN" and install the app.' },
        { title: 'Tap "Add connection" → "From QR code".',           desc: 'Or use "From link" and paste the VPN link (vless://…).' },
        { title: 'Scan the QR code on the left.',                    desc: 'The app will import your configuration automatically.' },
        { title: 'Tap Connect to activate.',                         desc: 'Your VPN is now active.' },
      ]},
      windows: { app: 'Amnezia VPN', appUrl: 'https://amnezia.org/en/downloads', steps: [
        { title: 'Download and install Amnezia VPN.',                desc: 'Get the installer from amnezia.org.' },
        { title: 'Click "Add connection" → paste the link.',         desc: 'Or scan the QR code with the built-in scanner.' },
        { title: 'The config is imported automatically.',            desc: 'You will see a new connection in the list.' },
        { title: 'Click Connect.',                                   desc: 'Your VPN is now active.' },
      ]},
      mac:     { app: 'Amnezia VPN', appUrl: 'https://amnezia.org/en/downloads', steps: [
        { title: 'Download and install Amnezia VPN.',                desc: 'Get the macOS package from amnezia.org.' },
        { title: 'Click "Add connection" → paste the link.',         desc: 'Or scan the QR code with the built-in scanner.' },
        { title: 'The config is imported automatically.',            desc: 'You will see a new connection in the list.' },
        { title: 'Click Connect.',                                   desc: 'Your VPN is now active.' },
      ]},
      linux:   { app: 'Amnezia VPN', appUrl: 'https://amnezia.org/en/downloads', steps: [
        { title: 'Download and install Amnezia VPN for Linux.',      desc: 'Get the package from amnezia.org.' },
        { title: 'Click "Add connection" → paste the link.',         desc: 'Or scan the QR code with the built-in scanner.' },
        { title: 'The config is imported automatically.',            desc: 'You will see a new connection in the list.' },
        { title: 'Click Connect.',                                   desc: 'Your VPN is now active.' },
      ]},
    },
  },
  {
    id: 'amneziawg',
    name: 'AmneziaWG',
    category: 'wireguard',
    platforms: ['ios', 'android'],
    url: 'https://docs.amnezia.org/documentation/amnezia-wg/',
    importMode: 'wireguard',
    // DPI-resistant WireGuard fork; imports our standard WireGuard .conf. Good
    // App-Store fallback for regions where general proxy clients are removed.
    availability: { regional: 'available' },
    protocols: { ...WG_ONLY },
    install: {
      ios:     { app: 'AmneziaWG', appUrl: 'https://apps.apple.com/app/amneziawg/id6478942365', steps: [
        { title: 'Install AmneziaWG from the App Store.',            desc: 'Official app by Privacy Technologies.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it to your device.' },
        { title: 'Open AmneziaWG → + → Import from file or QR.',      desc: 'Pick the .conf you downloaded, or scan the QR.' },
        { title: 'Toggle the tunnel on.',                            desc: 'Grant VPN permissions if prompted.' },
      ]},
      android: { app: 'AmneziaWG', appUrl: 'https://play.google.com/store/apps/details?id=org.amnezia.awg', steps: [
        { title: 'Install AmneziaWG from Google Play.',             desc: 'Official app by Privacy Technologies.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it to your device.' },
        { title: 'Open AmneziaWG → Import → From file or QR.',        desc: 'Pick the .conf, or scan the QR code.' },
        { title: 'Toggle the tunnel on.',                            desc: 'Grant VPN permissions if prompted.' },
      ]},
    },
  },
  {
    id: 'v2rayn',
    name: 'v2rayN',
    category: 'vless-vmess',
    platforms: ['windows', 'mac', 'linux'],
    url: 'https://github.com/2dust/v2rayN',
    importMode: 'subscription',
    protocols: { ...ALL_XRAY },
    install: {
      windows: { app: 'v2rayN', appUrl: 'https://github.com/2dust/v2rayN/releases/latest', steps: [
        { title: 'Download v2rayN from GitHub and unzip it.',         desc: 'Run v2rayN.exe (requires .NET runtime).' },
        { title: 'Copy the subscription link.',                       desc: 'Use the Copy subscription link button on the left.' },
        { title: 'Subscriptions → Subscription settings → Add.',      desc: 'Paste the URL, then Update subscription.' },
        { title: 'Select a server and set the system proxy.',         desc: 'Right-click the tray icon → System proxy → Auto.' },
      ]},
      mac: { app: 'v2rayN', appUrl: 'https://github.com/2dust/v2rayN/releases/latest', steps: [
        { title: 'Download the macOS build of v2rayN from GitHub.',   desc: 'Open the .dmg and move v2rayN to Applications.' },
        { title: 'Copy the subscription link.',                       desc: 'Use the Copy subscription link button on the left.' },
        { title: 'Subscriptions → Subscription settings → Add.',      desc: 'Paste the URL, then Update subscription.' },
        { title: 'Select a server and enable the system proxy.',      desc: 'From the menu bar icon → System proxy.' },
      ]},
      linux: { app: 'v2rayN', appUrl: 'https://github.com/2dust/v2rayN/releases/latest', steps: [
        { title: 'Download the Linux build of v2rayN from GitHub.',   desc: 'Extract and run it (requires .NET runtime).' },
        { title: 'Copy the subscription link.',                       desc: 'Use the Copy subscription link button on the left.' },
        { title: 'Subscriptions → Subscription settings → Add.',      desc: 'Paste the URL, then Update subscription.' },
        { title: 'Select a server and enable the system proxy.',      desc: 'Then start the connection.' },
      ]},
    },
  },
  {
    id: 'v2rayng',
    name: 'v2rayNG',
    category: 'vless-vmess',
    platforms: ['android'],
    url: 'https://github.com/2dust/v2rayNG',
    importMode: 'subscription',
    deepLink: 'v2rayng://install-sub?url=$URL',
    availability: { regional: 'check' },
    protocols: { ...ALL_XRAY,
      'vless-xhttp-tls': 'partial', 'vmess-xhttp-tls': 'partial',
      'vless-httpupgrade': 'partial', 'vmess-httpupgrade': 'partial',
    },
    notes: { 'vless-xhttp-tls': 'Requires v1.9.0+', 'vmess-xhttp-tls': 'Requires v1.9.0+' },
    install: {
      android: { app: 'v2rayNG', appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', steps: [
        { title: 'Install v2rayNG from Google Play.',                desc: 'Search for "v2rayNG" (with the G) and install.' },
        { title: 'Tap the menu → "Subscription group setting".',     desc: 'Add a new subscription group.' },
        { title: 'Paste the subscription URL and save.',             desc: 'Then tap the menu → "Update subscription".' },
        { title: 'Select a server and tap Connect.',                 desc: 'Tap the round button at the bottom to activate.' },
      ]},
    },
  },
  {
    id: 'singbox',
    name: 'sing-box',
    category: 'clash-singbox',
    platforms: ['ios', 'android', 'windows', 'mac', 'linux'],
    url: 'https://sing-box.sagernet.org',
    importMode: 'subscription',
    deepLink: 'sing-box://import-remote-profile?url=$URL',
    availability: { regional: 'check' },
    protocols: { ...ALL_XRAY, wireguard: 'full' },
    install: {
      // The classic "sing-box (SFI)" App Store build has had update/removal issues;
      // the maintained App Store build is "sing-box VT" (id6673731168).
      ios:     { app: 'sing-box VT', appUrl: 'https://apps.apple.com/app/sing-box-vt/id6673731168', steps: [
        { title: 'Install "sing-box VT" from the App Store.',        desc: 'The maintained App Store build of sing-box.' },
        { title: 'Tap + → Remote profile.',                          desc: 'Enter the subscription URL or scan the QR code.' },
        { title: 'Confirm the import.',                              desc: 'The profile will appear in your profile list.' },
        { title: 'Select the profile and tap Start.',                desc: 'Grant VPN permissions if prompted.' },
      ]},
      android: { app: 'sing-box (SFA)', appUrl: 'https://play.google.com/store/apps/details?id=io.nekohasekai.sfa', steps: [
        { title: 'Install sing-box from Google Play.',               desc: 'Search for "sing-box" — the official SFA app.' },
        { title: 'Tap + → Remote profile.',                          desc: 'Enter the subscription URL or scan the QR code.' },
        { title: 'Confirm the import.',                              desc: 'The profile will appear in your profile list.' },
        { title: 'Select the profile and tap Start.',                desc: 'Grant VPN permissions if prompted.' },
      ]},
      windows: { app: 'sing-box', appUrl: 'https://github.com/SagerNet/sing-box/releases/latest', steps: [
        { title: 'Download sing-box for Windows from GitHub.',       desc: 'Get the latest release installer.' },
        { title: 'Go to Profiles → Add remote profile.',             desc: 'Paste the subscription URL.' },
        { title: 'Confirm the import.',                              desc: 'The profile will appear in your profile list.' },
        { title: 'Select the profile and click Start.',              desc: 'The VPN is now active.' },
      ]},
      mac:     { app: 'sing-box VT', appUrl: 'https://apps.apple.com/app/sing-box-vt/id6673731168', steps: [
        { title: 'Install "sing-box VT" from the Mac App Store.',    desc: 'Or download from GitHub releases.' },
        { title: 'Go to Profiles → Add remote profile.',             desc: 'Paste the subscription URL.' },
        { title: 'Confirm the import.',                              desc: 'The profile will appear in your profile list.' },
        { title: 'Select the profile and click Start.',              desc: 'The VPN is now active.' },
      ]},
      linux:   { app: 'sing-box', appUrl: 'https://github.com/SagerNet/sing-box/releases/latest', steps: [
        { title: 'Download sing-box for Linux from GitHub.',         desc: 'Extract and place in /usr/local/bin/.' },
        { title: 'Download a GUI (Hiddify or SFM).',                 desc: 'Or run headless with the config JSON.' },
        { title: 'Import the subscription URL in the GUI.',          desc: 'Or fetch the config via curl and point sing-box at it.' },
        { title: 'Start the service.',                               desc: 'The VPN is now active.' },
      ]},
    },
  },
  {
    id: 'clashverge',
    name: 'Clash Verge',
    category: 'clash-singbox',
    platforms: ['windows', 'mac', 'linux'],
    url: 'https://github.com/clash-verge-rev/clash-verge-rev',
    importMode: 'subscription',
    protocols: { ...ALL_XRAY,
      wireguard: 'partial', 'vless-xhttp-tls': 'no', 'vmess-xhttp-tls': 'no',
      'vless-httpupgrade': 'partial', 'vmess-httpupgrade': 'partial',
    },
    notes: { 'wireguard': 'WireGuard via Clash Meta kernel' },
    install: {
      windows: { app: 'Clash Verge Rev', appUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest', steps: [
        { title: 'Download Clash Verge Rev from GitHub.',            desc: 'Run the installer.' },
        { title: 'Open Profiles → New profile → Remote URL.',        desc: 'Paste the Clash sub link (add ?format=clash to subscription URL).' },
        { title: 'Enable the profile.',                              desc: 'Click the three-dot menu → Use.' },
        { title: 'Enable System Proxy from the main screen.',        desc: 'The proxy is now active.' },
      ]},
      mac:     { app: 'Clash Verge Rev', appUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest', steps: [
        { title: 'Download Clash Verge Rev from GitHub.',            desc: 'Open the DMG and move to Applications.' },
        { title: 'Open Profiles → New profile → Remote URL.',        desc: 'Paste the Clash sub link (add ?format=clash to subscription URL).' },
        { title: 'Enable the profile.',                              desc: 'Click the three-dot menu → Use.' },
        { title: 'Enable System Proxy from the main screen.',        desc: 'The proxy is now active.' },
      ]},
      linux:   { app: 'Clash Verge Rev', appUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest', steps: [
        { title: 'Download the AppImage from GitHub.',               desc: 'Make it executable: chmod +x ClashVerge.AppImage' },
        { title: 'Open Profiles → New profile → Remote URL.',        desc: 'Paste the Clash sub link (add ?format=clash to subscription URL).' },
        { title: 'Enable the profile.',                              desc: 'Click the three-dot menu → Use.' },
        { title: 'Enable System Proxy from the main screen.',        desc: 'The proxy is now active.' },
      ]},
    },
  },
  {
    id: 'shadowrocket',
    name: 'Shadowrocket',
    category: 'vless-vmess',
    platforms: ['ios', 'mac'],
    url: 'https://apps.apple.com/app/shadowrocket/id932747118',
    importMode: 'subscription',
    availability: { regional: 'check' },
    protocols: { ...ALL_XRAY,
      wireguard: 'full', 'vless-xhttp-tls': 'unknown', 'vmess-xhttp-tls': 'unknown',
      'vless-httpupgrade': 'partial', 'vmess-httpupgrade': 'partial',
    },
    install: {
      ios:     { app: 'Shadowrocket', appUrl: 'https://apps.apple.com/app/shadowrocket/id932747118', steps: [
        { title: 'Purchase and install Shadowrocket from the App Store.', desc: 'It is a paid app — a one-time purchase.' },
        { title: 'Tap + → Subscribe.',                               desc: 'Paste the subscription URL in the URL field.' },
        { title: 'Tap Save.',                                        desc: 'The servers will be imported automatically.' },
        { title: 'Toggle the connection switch on.',                 desc: 'Grant VPN permissions if prompted.' },
      ]},
      mac:     { app: 'Shadowrocket', appUrl: 'https://apps.apple.com/app/shadowrocket/id932747118', steps: [
        { title: 'Install Shadowrocket from the Mac App Store.',     desc: 'Paid app; available on Apple Silicon Macs.' },
        { title: 'Click + → Subscribe.',                             desc: 'Paste the subscription URL in the URL field.' },
        { title: 'Click Save.',                                      desc: 'The servers import automatically.' },
        { title: 'Toggle the connection on.',                        desc: 'Grant VPN permissions if prompted.' },
      ]},
    },
  },
  {
    id: 'streisand',
    name: 'Streisand',
    category: 'vless-vmess',
    platforms: ['ios', 'mac'],
    url: 'https://apps.apple.com/app/streisand/id6450534064',
    importMode: 'subscription',
    // Reported removed from some regional App Stores in 2024 — keep as a non-primary option.
    availability: { regional: 'removed' },
    protocols: { ...ALL_XRAY,
      'vless-xhttp-tls': 'partial', 'vmess-xhttp-tls': 'partial',
      'vless-httpupgrade': 'partial', 'vmess-httpupgrade': 'partial',
    },
    install: {
      ios: { app: 'Streisand', appUrl: 'https://apps.apple.com/app/streisand/id6450534064', steps: [
        { title: 'Install Streisand from the App Store.',             desc: 'It is free.' },
        { title: 'Tap + → Add from subscription.',                    desc: 'Paste the subscription link or scan the QR code.' },
        { title: 'Confirm the import.',                               desc: 'Your servers appear in the list.' },
        { title: 'Select a server and tap Connect.',                  desc: 'Grant VPN permissions if prompted.' },
      ]},
      mac: { app: 'Streisand', appUrl: 'https://apps.apple.com/app/streisand/id6450534064', steps: [
        { title: 'Install Streisand from the Mac App Store.',         desc: 'Free; available on Apple Silicon Macs.' },
        { title: 'Click + → Add from subscription.',                  desc: 'Paste the subscription link or scan the QR code.' },
        { title: 'Confirm the import.',                               desc: 'Your servers appear in the list.' },
        { title: 'Select a server and connect.',                      desc: 'Grant VPN permissions if prompted.' },
      ]},
    },
  },
  {
    id: 'nekoray',
    name: 'NekoRay / NekoBox',
    category: 'clash-singbox',
    platforms: ['windows', 'linux', 'android'],
    url: 'https://github.com/MatsuriDayo/nekoray',
    importMode: 'subscription',
    protocols: { ...ALL_XRAY, wireguard: 'full' },
    install: {
      windows: { app: 'NekoRay', appUrl: 'https://github.com/MatsuriDayo/nekoray/releases/latest', steps: [
        { title: 'Download NekoRay from GitHub and unzip it.',        desc: 'Run nekoray.exe.' },
        { title: 'Program → Add profile from clipboard.',             desc: 'Copy the subscription link first, or use Groups → New subscription.' },
        { title: 'Select a server and enable Tun Mode.',              desc: 'Set system proxy from the toolbar.' },
        { title: 'Start the connection.',                             desc: 'The VPN is now active.' },
      ]},
      linux: { app: 'NekoRay', appUrl: 'https://github.com/MatsuriDayo/nekoray/releases/latest', steps: [
        { title: 'Download the NekoRay AppImage from GitHub.',        desc: 'Make it executable: chmod +x nekoray.AppImage' },
        { title: 'Program → Add profile from clipboard.',             desc: 'Copy the subscription link first, or use Groups → New subscription.' },
        { title: 'Select a server and enable Tun Mode.',              desc: 'Set system proxy from the toolbar.' },
        { title: 'Start the connection.',                             desc: 'The VPN is now active.' },
      ]},
      android: { app: 'NekoBox', appUrl: 'https://github.com/MatsuriDayo/NekoBoxForAndroid/releases/latest', steps: [
        { title: 'Install NekoBox from GitHub.',                      desc: 'Download and install the APK.' },
        { title: 'Tap + → Add profile from clipboard / subscription.', desc: 'Paste the subscription link or scan the QR code.' },
        { title: 'Select a server.',                                  desc: 'Tap the server you want to use.' },
        { title: 'Tap the connect button.',                          desc: 'Grant VPN permissions if prompted.' },
      ]},
    },
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    category: 'wireguard',
    platforms: ['ios', 'android', 'windows', 'mac', 'linux'],
    url: 'https://www.wireguard.com/install/',
    importMode: 'wireguard',
    availability: { regional: 'available' },
    protocols: { ...WG_ONLY },
    install: {
      ios:     { app: 'WireGuard', appUrl: 'https://apps.apple.com/app/wireguard/id1441195209', steps: [
        { title: 'Install WireGuard from the App Store.',            desc: 'Official free app.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it to your device.' },
        { title: 'Open WireGuard → + → Create from file or QR.',      desc: 'Pick the .conf you downloaded, or scan the QR.' },
        { title: 'Toggle the tunnel on.',                            desc: 'Grant VPN permissions if prompted.' },
      ]},
      android: { app: 'WireGuard', appUrl: 'https://play.google.com/store/apps/details?id=com.wireguard.android', steps: [
        { title: 'Install WireGuard from Google Play.',             desc: 'Official free app.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it to your device.' },
        { title: 'Open WireGuard → + → Import from file or archive.', desc: 'Pick the .conf, or use + → Scan from QR code.' },
        { title: 'Toggle the tunnel on.',                            desc: 'Grant VPN permissions if prompted.' },
      ]},
      windows: { app: 'WireGuard', appUrl: 'https://www.wireguard.com/install/', steps: [
        { title: 'Download and install WireGuard for Windows.',      desc: 'From wireguard.com/install.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it somewhere you can find it.' },
        { title: 'WireGuard → Add Tunnel → import the .conf.',        desc: 'Select the file you downloaded.' },
        { title: 'Click Activate.',                                  desc: 'The tunnel is now connected.' },
      ]},
      mac:     { app: 'WireGuard', appUrl: 'https://apps.apple.com/app/wireguard/id1451685025', steps: [
        { title: 'Install WireGuard from the Mac App Store.',        desc: 'Official free app.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it to your Mac.' },
        { title: 'WireGuard → Import tunnel(s) from file.',           desc: 'Select the .conf you downloaded.' },
        { title: 'Click Activate.',                                  desc: 'The tunnel is now connected.' },
      ]},
      linux:   { app: 'WireGuard', appUrl: 'https://www.wireguard.com/install/', steps: [
        { title: 'Install WireGuard: sudo apt install wireguard.',   desc: 'Or your distro’s package manager.' },
        { title: 'Download the .conf file (button on the left).',     desc: 'Save it as e.g. vpn.conf.' },
        { title: 'Bring it up: sudo wg-quick up ./vpn.conf.',         desc: 'Or import it into the NetworkManager GUI.' },
        { title: 'Verify with: sudo wg.',                            desc: 'The tunnel is now connected.' },
      ]},
    },
  },
];

/** Look up a client matrix entry by id. */
export function getClientEntry(id: string): ClientEntry | undefined {
  return CLIENT_MATRIX.find(c => c.id === id);
}

/**
 * Does this client support at least one of the given protocols? A client is
 * "compatible" with an invite if it can import any of the invite's protocols at
 * 'full' or 'partial' tier. Unknown clients are treated as compatible.
 */
export function clientSupportsAny(id: string, protocols: string[]): boolean {
  const entry = getClientEntry(id);
  if (!entry) return true;
  return protocols.some(p => {
    const tier = entry.protocols[p];
    return tier === 'full' || tier === 'partial';
  });
}

// ── Invite/onboarding adapter ────────────────────────────────────────────────
// The onboarding page derives its per-OS app picker from this matrix. Shape kept
// compatible with the page's renderer: id → { name, deepLink, linkMode, platforms }.

export interface InviteClientDef {
  name: string;
  deepLink?: string;
  linkMode?: ImportMode;
  recommended?: boolean;
  availability?: Partial<Record<string, Availability>>;
  platforms: Record<Platform, { app: string; appUrl: string; steps: InstallStep[] } | null>;
}

const ALL_PLATFORMS: Platform[] = ['ios', 'android', 'windows', 'mac', 'linux'];

/** Build the onboarding client definitions from the matrix (single source). */
export function inviteClientDefs(): Record<string, InviteClientDef> {
  const out: Record<string, InviteClientDef> = {};
  for (const c of CLIENT_MATRIX) {
    if (c.showInInvite === false || !c.install) continue;
    const platforms = {} as InviteClientDef['platforms'];
    for (const p of ALL_PLATFORMS) platforms[p] = c.install[p] ?? null;
    out[c.id] = {
      name: c.name,
      deepLink: c.deepLink,
      linkMode: c.importMode,
      recommended: c.recommended,
      availability: c.availability,
      platforms,
    };
  }
  return out;
}
