import { loadVersions } from '../lib/data';
import { sitemapPaths } from '../lib/paths';

export function GET(context: { site: URL }): Response {
  const urls = sitemapPaths(loadVersions())
    .map((p) => `  <url><loc>${new URL(p, context.site).href}</loc></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
