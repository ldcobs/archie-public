# Archie Dashboard

The web dashboard for Archie — a Next.js app that provides the management UI:
access keys, invites, live connections, the security/threat views, and device
management. It talks to the Archie API and is served behind nginx in the
deployed stack.

This app is built and configured automatically by the Archie installer; you do
not run it by hand in a normal deployment. All deployment-specific values
(server address, brand name, keys) come from environment variables
(`NEXT_PUBLIC_*`) set at build time — see `src/lib/server-config.ts`.

## Local development

```bash
npm install
npm run dev
```

Then open the printed URL. Without the `NEXT_PUBLIC_*` values set, host- and
key-specific fields are intentionally blank (the app fails closed rather than
embedding any one deployment's values).
