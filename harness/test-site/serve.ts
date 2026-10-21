// Local course site for RP1's live check: 10 assignment links, each page with a Download button.
// Run: node harness/test-site/serve.ts, then open http://assignments.localtest.me:8123/ (localtest.me points at this
// PC; plain localhost can never be a run's Site).
import { createServer, type ServerResponse } from 'node:http';

const PORT = 8123;
// IDs, like real course sites: the agent can't count assignments in the URL.
const IDS = [48213, 48227, 48230, 48241, 48256, 48262, 48279, 48283, 48294, 48301];

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
// Links that aren't assignments, so the repeat's built-like check has something to leave out.
const nav = '<nav><a href="/">Course home</a> · <a href="/grades">Grades</a> · <a href="/logout">Log out</a></nav>';

function send(res: ServerResponse, html: string, status = 200) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  console.log(req.method, url.pathname);
  const id = Number(/^\/(?:assignments|files)\/(\d+)$/.exec(url.pathname)?.[1]);
  const n = IDS.indexOf(id) + 1;
  if (url.pathname === '/') {
    const list = IDS.map((id, i) => `<li><a href="/assignments/${id}">Assignment ${i + 1}</a></li>`).join('');
    return send(res, page('Web Agents 101', `${nav}<main><h1>Web Agents 101</h1><h2>Assignments</h2><ul>${list}</ul></main>`));
  }
  if (n && url.pathname.startsWith('/assignments/')) {
    return send(res, page(`Assignment ${n}`, `${nav}<main><h1>Assignment ${n}</h1><p>Due Friday. Read the brief before class.</p><a href="/files/${id}" download>Download</a></main>`));
  }
  if (n && url.pathname.startsWith('/files/')) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="assignment-${n}.txt"` });
    return res.end(`Assignment ${n} brief (test file).\n`);
  }
  send(res, page('Not here', `${nav}<main><p>Nothing here (test site).</p></main>`), 404);
}).listen(PORT, '127.0.0.1', () => console.log(`Test site: http://assignments.localtest.me:${PORT}/`));
