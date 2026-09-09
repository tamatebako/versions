import rss from '@astrojs/rss';
import { loadVersions } from '../lib/data';

const v = loadVersions();

export async function GET(context: { site: URL }) {
  // Honest framing (plan 05): the site is stateless across builds, so the
  // feed is the CURRENT latest-per-line snapshot with pubDate = the
  // release's published_at — not an event log.
  const seen = new Set<string>();
  const items: Parameters<typeof rss>[0]['items'] = [];
  for (const r of v.runtimes) {
    if (!r.latest_in_line) continue;
    const key = `${r.engine}|${r.lang_version}|${r.flavor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title: `${r.engine} ${r.lang_version}${r.flavor ? `-${r.flavor}` : ''} · tebako ${r.tebako_line}`,
      pubDate: new Date(r.release.published_at),
      description: `Runtime line ${r.reference} — ${r.triplet} et al.`,
      link: r.release.url,
      categories: [r.engine],
    });
  }
  return rss({
    title: 'tebako versions',
    description:
      'Current catalog snapshot: the latest tebako runtime lines, payloads and toolchain releases.',
    site: context.site,
    items,
    customData: '<language>en-us</language>',
  });
}
