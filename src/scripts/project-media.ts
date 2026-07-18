/*
 * project-media -- the only client runtime a project page ships, and only when
 * it has a <video data-project-video>. Same contract as /academia's script
 * (progressive enhancement over correct server markup, zero islands):
 *
 *   Demo clips are muted looping <video preload="none">. They play only while
 *   at least half visible (IntersectionObserver ≥50%) and pause otherwise, so
 *   nothing decodes off-screen.
 *
 *   prefers-reduced-motion: never autoplay -- the poster stands in and the
 *   viewer gets native controls to opt in.
 *
 * Re-initialised on every ClientRouter swap (prior observer disconnected first).
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
    document.querySelectorAll<HTMLVideoElement>('video[data-project-video]'),
  );
  if (videos.length === 0) return;

  if (reducedMotion()) {
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
