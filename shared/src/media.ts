/**
 * Random photos and GIFs for chat. Used by the chat simulator, the demo seed and the
 * GIF & photo picker in the composer, so all of them draw from the same catalog.
 *
 * Photos come from picsum.photos: every seed gives a different photo.
 * GIFs come from GIPHY (a fixed list of verified files) and cataas.com (random cat GIFs).
 */

export const GIPHY_GIF_IDS = [
  "3o7aD2saalBwwftBIY",
  "xUPGcguWZHRC2HyBRS",
  "xT9IgG50Fb7Mi0prBC",
  "l3q2K5jinAlChoCLS",
  "3oriO0OEd9QIDdllqo",
  "3o7TKSjRrfIPjeiVyM",
  "26tn33aiTi1jkl6H6",
] as const;

export interface MediaPick {
  url: string;
  kind: "photo" | "gif";
}

type Random = () => number;

function pickOne<T>(items: readonly T[], rand: Random): T {
  return items[Math.floor(rand() * items.length)];
}

export function randomPhotoUrl(rand: Random = Math.random): string {
  const seed = Math.floor(rand() * 1_000_000);
  return `https://picsum.photos/seed/syncro${seed}/640/420`;
}

export function randomGifUrl(rand: Random = Math.random): string {
  if (rand() < 0.5) {
    return `https://media.giphy.com/media/${pickOne(GIPHY_GIF_IDS, rand)}/giphy.gif`;
  }
  return `https://cataas.com/cat/gif?r=${Math.floor(rand() * 1_000_000_000)}`;
}

export function randomMedia(rand: Random = Math.random): MediaPick {
  if (rand() < 0.5) {
    return { url: randomPhotoUrl(rand), kind: "photo" };
  }
  return { url: randomGifUrl(rand), kind: "gif" };
}

export function isGifUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    /\.gif(\?|$)/i.test(url) ||
    url.includes("media.giphy.com/media/") ||
    url.includes("cataas.com/cat/gif")
  );
}
