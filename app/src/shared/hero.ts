/**
 * VENDORED from adventure/src/lib/catalog.ts (photographicHero,
 * isJunkHeroUrl) at commit 25cf6ea. Do not edit here — edit the source and
 * re-vendor. FR62: adventure's CI carries a drift gate on this file.
 *
 * `hero_image_url` is whatever Wikipedia's pageimages API calls the
 * article's lead image, unfiltered — for administrative places that's
 * routinely a flag, coat of arms or locator map. `hero_gallery` already
 * excludes those, so a junk hero with a clean gallery behind it is a
 * same-catalog inconsistency: prefer the first photographic candidate.
 */
const JUNK_HERO_FILENAME = /map|flag|coat|seal|logo|locator|banner|icon|emblem|arms/i;

function isJunkHeroUrl(url: string): boolean {
  const file = url.split('?')[0].split('/').pop() ?? url;
  return JUNK_HERO_FILENAME.test(decodeURIComponent(file));
}

export function photographicHero(d: {
  hero_image_url: string | null;
  hero_gallery: { url: string }[] | null;
}): string {
  const hero = d.hero_image_url ?? '';
  if (hero && !isJunkHeroUrl(hero)) return hero;
  return d.hero_gallery?.find((g) => !isJunkHeroUrl(g.url))?.url ?? '';
}
