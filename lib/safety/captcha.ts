// CAPTCHA frames (4.2): spots reCAPTCHA, hCaptcha, Turnstile, DataDome and Arkose, so the run pauses and you solve them, never the agent.
import { allElements } from '../page/reader.ts';

const RECAPTCHA_HOSTS = ['www.google.com', 'recaptcha.google.com', 'www.recaptcha.net', 'recaptcha.net'];

// The CAPTCHA a frame URL belongs to, or null. Only the widgets' own frame pages match, never a page about them
// (Google's demo lives under /recaptcha/api2/demo). Rules follow Firefox's CAPTCHA detector:
// https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/captchadetection/CaptchaDetectionChild.sys.mjs
// Hosts: https://developers.google.com/recaptcha/docs/faq · https://docs.hcaptcha.com/ (any *.hcaptcha.com)
export function captchaKind(src: string): string | null {
  const url = URL.parse(src);
  if (!url || url.protocol !== 'https:') return null;
  const { hostname: host, pathname: path } = url;
  // Checkbox (anchor) and image puzzle (bframe). An invisible widget (v3, invisible v2) only shows a corner badge.
  if (RECAPTCHA_HOSTS.includes(host) && /^\/recaptcha\/(api2|enterprise)\/(anchor|bframe)$/.test(path)) {
    return url.searchParams.get('size') === 'invisible' ? null : 'reCAPTCHA';
  }
  if ((host === 'hcaptcha.com' || host.endsWith('.hcaptcha.com')) && path.endsWith('/static/hcaptcha.html')) {
    return /size=invisible|frame=checkbox-invisible/.test(url.hash) ? null : 'hCaptcha';
  }
  if (host === 'challenges.cloudflare.com' && path.startsWith('/cdn-cgi/challenge-platform/')) return 'Turnstile';
  if (host === 'geo.captcha-delivery.com' && path.startsWith('/captcha/')) return 'DataDome';
  if (host === 'client-api.arkoselabs.com') return 'Arkose';
  return null;
}

// The CAPTCHA a person can see in this frame, or ''. Runs in the content script; closed shadow roots (Turnstile) included.
export function visibleCaptcha(): string {
  for (const el of allElements(document)) {
    const kind = el instanceof HTMLIFrameElement ? captchaKind(el.src) : null;
    if (!kind) continue;
    const r = el.getBoundingClientRect();
    // Puzzle frames wait at visibility:hidden or far off the page; invisible-mode frames have (almost) no size.
    const shown = el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && r.width >= 20 && r.height >= 20;
    if (shown && r.bottom + scrollY > 0 && r.right + scrollX > 0) return kind;
  }
  return '';
}
