// Side panel welcome, before the log: 1 the Ichiro symbol and "Connect to your agent", 2 a prompt you paste into your
// coding agent to set up the connection, then "I've connected". Shown until that press (main.ts).
import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';

// Placeholder until the repo has a public home (developer, 2026-10-24). <owner> can't be a GitHub account, so an agent
// can never clone a stranger's repo from it: the prompt tells it to ask you for the real link.
const REPO = 'https://github.com/<owner>/ichiro';

// What you paste into the agent. id: this extension's, the one the local helper must be registered for.
export const connectPrompt = (id: string) => `Connect yourself to my browser through Ichiro, a Chrome extension with an MCP server.

1. Clone ${REPO} and run npm install in it. That link is a placeholder: ask me for the real one.
2. Register the browser helper for my extension: npm run host:install -- ${id}
   If it refuses because it runs inside the Claude desktop app on Windows, ask me to run that one command in my own terminal.
3. Add an MCP server named "ichiro" (stdio) that runs: node <the clone's folder>/host/mcp.ts
   In Claude Code: claude mcp add --transport stdio --scope user ichiro -- node <the clone's folder>/host/mcp.ts
4. Tell me when it's done, and whether I need to restart you so the new "browser" tool loads. I'll press "I've connected" in the Ichiro side panel.`;

// Draws the welcome into el; done runs on "I've connected".
export const welcome = (el: HTMLElement, done: () => void) => render(<Welcome done={done} />, el);

function Welcome({ done }: { done: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [copied, setCopied] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const prompt = connectPrompt(browser.runtime.id);
  // A click is the user gesture the clipboard needs. Refused anyway: the text is selected for your own Ctrl+C.
  // Source: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
  const copy = () =>
    navigator.clipboard.writeText(prompt).then(
      () => setCopied('Copied'),
      () => {
        box.current?.select();
        setCopied('Selected: press Ctrl+C (Cmd+C on a Mac)');
      },
    );

  // key: each step mounts fresh, so its autoFocus lands on its first button.
  if (step === 1) {
    return (
      <section key={1} class="welcome" aria-labelledby="welcome-title">
        <p class="welcome-step">Step 1 of 2</p>
        <picture>
          <source srcset="/blink-still.svg" media="(prefers-reduced-motion: reduce)" />
          <img src="/blink.svg" alt="" width={104} height={100} />
        </picture>
        <h1 id="welcome-title">Welcome to Ichiro</h1>
        <p>Let your coding agent use this browser: read pages, click and type. Anything risky waits for your OK.</p>
        <button type="button" class="cta" autoFocus onClick={() => setStep(2)}>
          Connect to your agent
        </button>
      </section>
    );
  }
  return (
    <section key={2} class="welcome connect" aria-labelledby="connect-title">
      <p class="welcome-step">Step 2 of 2</p>
      <h1 id="connect-title">Connect your agent</h1>
      <p>Copy this prompt and paste it into your coding agent (Claude Code, Codex…). It sets up the connection.</p>
      <textarea ref={box} class="prompt" readOnly rows={11} aria-label="Prompt for your agent" value={prompt} />
      {/* aria-live: a screen reader says "Copied" (or the Ctrl+C hint) when the label changes. */}
      <button type="button" autoFocus aria-live="polite" onClick={copy}>
        {copied || 'Copy prompt'}
      </button>
      <button type="button" class="cta" onClick={done}>
        I've connected
      </button>
      <button type="button" class="link" onClick={() => setStep(1)}>
        Back
      </button>
    </section>
  );
}
