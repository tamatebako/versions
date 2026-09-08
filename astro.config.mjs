// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.tebako.org',
  base: '/versions',
  output: 'static',
  trailingSlash: 'ignore',
});
