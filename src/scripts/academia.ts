/*
 * /academia client runtime — the only page that ships it. Progressive
 * enhancement over correct server output (zero islands, vanilla only):
 *
 *   The project demos are muted looping <video preload="none"> elements. They
 *   play only while at least half visible (IntersectionObserver, ≥50% ratio)
 *   and pause otherwise, so nothing decodes off-screen and at most a couple of
 *   clips run at once.
 *
 *   prefers-reduced-motion: never autoplay. Instead the poster stands in and
 *   the viewer gets native controls to opt in — the media stays reachable
 *   without any motion they didn't ask for.
 *
 * Re-initialised on every ClientRouter swap (the observer from the previous
 * page is disconnected first) so navigating away and back rewires cleanly.
 */

export {};

let observer: IntersectionObserver | null = null;

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setupVideos(): void {
  observer?.disconnect();
  observer = null;

  const videos = Array.from(
    document.querySelectorAll<HTMLVideoElement>('video[data-academia-video]'),
  );
  if (videos.length === 0) return;

  if (reducedMotion()) {
    // No autoplay; surface the poster with native controls so it's still playable.
    videos.forEach((v) => {
      v.controls = true;
    });
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          // play() rejects if the tab is backgrounded or the source 404s; ignore.
          void video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      }
    },
    { threshold: [0, 0.5] },
  );
  videos.forEach((video) => observer!.observe(video));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupVideos, { once: true });
} else {
  setupVideos();
}
document.addEventListener('astro:page-load', setupVideos);
