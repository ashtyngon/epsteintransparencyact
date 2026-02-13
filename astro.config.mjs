// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import keystatic from '@keystatic/astro';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const isProduction = process.env.NODE_ENV === 'production';
const __dirname = dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  site: 'https://epsteintransparencyact.com',
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Fix Vite 6 + Keystatic ESM resolution issue
        'micromark-extension-gfm-autolink-literal': resolve(
          __dirname,
          'node_modules/micromark-extension-gfm-autolink-literal/index.js'
        ),
      },
    },
  },
  integrations: [
    react(),
    markdoc(),
    ...(isProduction ? [] : [keystatic()]),
    sitemap(),
  ],
});
