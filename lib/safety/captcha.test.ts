// Checks captchaKind: which frame URLs count as a CAPTCHA (4.2). Run: npm test
import { captchaKind } from './captcha.ts';

const cases: [string, string | null][] = [
  ['https://www.google.com/recaptcha/api2/anchor?ar=1&k=abc&size=normal', 'reCAPTCHA'],
  ['https://www.google.com/recaptcha/api2/bframe?hl=en&k=abc', 'reCAPTCHA'], // the image puzzle
  ['https://www.recaptcha.net/recaptcha/api2/anchor?k=abc', 'reCAPTCHA'],
  ['https://www.google.com/recaptcha/enterprise/anchor?k=abc', 'reCAPTCHA'],
  ['https://www.google.com/recaptcha/api2/anchor?k=abc&size=invisible', null], // v3 badge
  ['https://www.google.com/recaptcha/api2/demo', null], // a page about it, with a form you can submit
  ['https://www.google.com/recaptcha/admin', null],
  ['https://www.google.com/maps/embed?pb=x', null],
  ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=1', 'hCaptcha'],
  ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=1', 'hCaptcha'],
  ['https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox-invisible', null],
  ['https://accounts.hcaptcha.com/demo', null], // hCaptcha's demo page
  ['https://evilhcaptcha.com/captcha/v1/abc/static/hcaptcha.html', null], // only hcaptcha.com and its subdomains
  ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x', 'Turnstile'],
  ['http://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', null], // https only
  ['https://geo.captcha-delivery.com/captcha/?initialCid=x', 'DataDome'],
  ['https://client-api.arkoselabs.com/fc/assets/ec-game-core/game-core/1/standard/index.html', 'Arkose'],
  ['about:blank', null],
  ['', null],
];
for (const [src, want] of cases) {
  const got = captchaKind(src);
  if (got !== want) throw new Error(`captchaKind(${JSON.stringify(src)}) = ${got}, want ${want}`);
}
