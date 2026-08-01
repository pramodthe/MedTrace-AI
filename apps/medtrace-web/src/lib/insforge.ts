import { createClient } from '@insforge/sdk';

const baseUrl = import.meta.env.VITE_INSFORGE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl || !anonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[insforge] VITE_INSFORGE_URL or VITE_INSFORGE_ANON_KEY missing. SDK reads will fail.',
  );
}

export const insforge = createClient({
  baseUrl: baseUrl ?? '',
  anonKey: anonKey ?? '',
});
