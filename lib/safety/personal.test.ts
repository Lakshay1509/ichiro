// Checks personalKind (which fields need your yes before the agent types into them, 4.3). Run: npm test
import { personalKind } from './personal.ts';

// [autocomplete, type, labels, search box?, want]
const cases: [string, string, string, boolean, string | null][] = [
  // Marked fields (HTML autofill names), with section / shipping / contact-type tokens in front
  ['given-name', 'text', '', false, 'name'],
  ['shipping street-address', 'text', '', false, 'address'],
  ['section-a billing postal-code', 'text', '', false, 'address'],
  ['home email', 'text', '', false, 'email'],
  ['mobile tel-national', 'text', '', false, 'phone'],
  ['bday-month', '', '', false, 'birthday'],
  ['username', 'text', 'Username', false, null],
  ['cc-name', 'text', '', false, null], // a card field: a secret, refused before this check (4.2)
  // Field types
  ['', 'email', '', false, 'email'],
  ['', 'tel', '', false, 'phone'],
  ['off', 'email', 'Search', true, 'email'], // a search box still can't take an email field's job
  // Unmarked fields, by their words (most hand-made forms, Google Forms)
  ['off', 'text', 'Name', false, 'name'],
  ['', 'text', 'First Name *', false, 'name'],
  ['', 'text', ' first_name', false, 'name'],
  ['', 'text', ' lastname', false, 'name'],
  ['', 'text', 'Your email address', false, 'email'],
  ['', 'text', ' emailAddress', false, 'email'],
  ['', 'text', 'E-mail', false, 'email'],
  ['', 'text', 'Phone number', false, 'phone'],
  ['', 'text', 'Date of birth', false, 'birthday'],
  ['', 'text', 'Street address', false, 'address'],
  ['', 'text', 'ZIP / Postal code', false, 'address'],
  ['', 'text', 'City', false, 'address'], // a checkout city box
  ['address-level2', 'text', 'City', true, 'address'], // a search box that says it takes your city still asks
  ['', 'text', 'Company name', false, 'name'], // asks more than needed: the safe side
  // Not personal
  ['', 'text', 'Username', false, null],
  ['', 'search', 'Search by name', true, null],
  ['off', 'text', 'Search Wikipedia search', true, null],
  ['', 'text', 'City, state, country  location', true, null], // Kroger's job-search location combobox (in role=search)
  ['', 'text', 'What needs to be done?', false, null], // TodoMVC
  ['', 'text', 'Where are you going?', false, null], // Booking.com
  ['', 'text', 'Hostname', false, null],
];
for (const [autocomplete, type, labels, search, want] of cases) {
  const got = personalKind(autocomplete, type, labels, search);
  if (got !== want) throw new Error(`personalKind(${JSON.stringify([autocomplete, type, labels, search])}) = ${got}, want ${want}`);
}
