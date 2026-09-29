import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');
  return {
    plugins: [react()],
    // Expose only the public Supabase URL and anon key; the root .env also holds server secrets.
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.SUPABASE_URL ?? ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
      // Route Supabase Auth through /supabase on our own origin (dev server or Caddy in production).
      'import.meta.env.VITE_SUPABASE_VIA_PROXY': JSON.stringify(mode === 'development' || env.SUPABASE_VIA_PROXY === 'true'),
    },
    server: {
      port: 3000,
      proxy: {
        // Some networks (e.g. several Indian ISPs) block browser connections to *.supabase.co;
        // in dev the browser reaches Supabase Auth through this same-origin proxy instead.
        ...(env.SUPABASE_URL
          ? {
              '/supabase': {
                target: env.SUPABASE_URL,
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/supabase/, ''),
              },
            }
          : {}),
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
