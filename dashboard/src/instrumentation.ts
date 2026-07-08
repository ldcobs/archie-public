export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic import keeps 'crypto' out of the edge bundle — instrumentation.ts
  // is compiled for both runtimes; top-level Node.js imports break the edge build.
  const { randomBytes } = await import('crypto');

  const errors: string[] = [];

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === 'dev-only-change-me') {
    errors.push(
      '  AUTH_SECRET is not set or is still the dev default.\n' +
      '  Admin sessions can be forged. Set a strong random secret in .env:\n' +
      '  AUTH_SECRET=' + randomBytes(32).toString('hex'),
    );
  }

  if (!process.env.SERVER_DOMAIN) {
    errors.push(
      '  SERVER_DOMAIN is not set. Generated VPN configs will have no server address.',
    );
  }

  if (errors.length > 0) {
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════╗',
      '║  ARCHIE CONFIGURATION WARNING                        ║',
      '╚══════════════════════════════════════════════════════╝',
      ...errors.flatMap(e => ['', e]),
      '',
    ];
    console.warn(lines.join('\n')); // intentional startup warning
  }
}
