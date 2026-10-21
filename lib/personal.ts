// Personal data (4.3): typing your name, email, phone, address or birthday into a page needs your yes first. Any site.
import { StopLine } from './messages.ts';
import { name, role } from './reader.ts';

// Autofill field names by kind. A token list like "section-x shipping street-address" or "home email" is fine.
// Source: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
const AUTOFILL: [string, RegExp][] = [
  ['name', /^(name|honorific-prefix|given-name|additional-name|family-name|honorific-suffix|nickname)$/],
  ['email', /^email$/],
  ['phone', /^tel(-[a-z-]+)?$/],
  ['address', /^(street-address|address-line[1-3]|address-level[1-4]|postal-code|country|country-name)$/],
  ['birthday', /^bday(-day|-month|-year)?$/],
];

// The same kinds by the words a field is labelled with, for the many forms that don't mark their fields. Email first:
// "Email address" is an email, not an address.
const WORDS: [string, RegExp][] = [
  ['email', /\be ?mail\b/],
  ['birthday', /\b(birthday|birthdate|birth|dob)\b/],
  ['phone', /\b(phone|telephone|tel|mobile|cell)\b/],
  ['address', /\b(address|street|city|zip|zipcode|postcode|postal code|pin ?code)\b/],
  ['name', /\b(name|surname|first ?name|last ?name|full ?name)\b/],
];

// "firstName" / "first_name" / "First Name:" → "first name".
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z]+/g, ' ');

// The kind of personal data a field takes, or null. labels: its name, name="" and id. A search box is judged by its
// autocomplete and type only: "Search by name" asks for a search, not your name.
export function personalKind(autocomplete: string, type: string, labels: string, search: boolean): string | null {
  const tokens = autocomplete.toLowerCase().split(/\s+/);
  const byAutofill = AUTOFILL.find(([, re]) => tokens.some((t) => re.test(t)))?.[0];
  if (byAutofill) return byAutofill;
  if (type === 'email') return 'email';
  if (type === 'tel') return 'phone';
  if (search) return null;
  const w = words(labels);
  return WORDS.find(([, re]) => re.test(w))?.[0] ?? null;
}

// True if value is in the goal you typed, as whole words (case and spaces ignored): you already gave it for this task,
// so typing it on the run's Sites needs no second yes. A value from anywhere else (read off a page, made up) still asks.
export function inGoal(value: string, goal: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const v = norm(value);
  if (!v) return false;
  const exact = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Not inside a longer word: "Ann" is not in "annual report".
  return new RegExp(`(?<![\\p{L}\\p{N}])${exact}(?![\\p{L}\\p{N}])`, 'u').test(norm(goal));
}

// Throws a stop-line (Allow once / I'll do it) if el takes personal data. Runs in the content script.
export function checkPersonal(el: Element, what: string) {
  const labels = [name(el), el.getAttribute('name'), el.id].join(' ');
  const kind = personalKind(el.getAttribute('autocomplete') ?? '', el instanceof HTMLInputElement ? el.type : '', labels, role(el) === 'searchbox');
  if (kind) throw new StopLine(`Stop-line: ${what} ${JSON.stringify(name(el))} (personal data: ${kind}). Needs your ok.`);
}
