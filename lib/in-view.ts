// Frames (#16): does this frame show on the tab's screen? Asked inside the frame, so it works in other sites' frames too.
// With no root, IntersectionObserver measures against the top page's viewport, clipped by every frame on the way.
// Source: https://w3c.github.io/IntersectionObserver/ (implicit root; "compute the intersection")
export function onScreen(waitMs = 300): Promise<boolean | null> {
  return new Promise((resolve) => {
    const done = (shown: boolean | null) => {
      clearTimeout(timer);
      io.disconnect();
      resolve(shown);
    };
    // It answers once right after observe. A hidden tab may not render, so no answer: null, and the frame is read as before.
    const timer = setTimeout(() => done(null), waitMs);
    const io = new IntersectionObserver(([entry]) => done(!!entry && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0));
    io.observe(document.documentElement);
  });
}
