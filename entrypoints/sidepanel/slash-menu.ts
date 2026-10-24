// The / menu over the command box: lists the commands that start with what you typed.
// Up/Down move, Enter or Tab fills the command in, Escape closes, a click fills it in too.

export function slashMenu(input: HTMLInputElement, commands: Record<string, { help: string }>) {
  const list = document.querySelector<HTMLElement>('#slash')!;
  const rows = () => [...list.children] as HTMLElement[];
  let at = 0;

  // Row i is the one Enter picks.
  const mark = (i: number) => {
    at = i;
    rows().forEach((row, n) => row.setAttribute('aria-selected', String(n === i)));
    rows()[i]?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', rows()[i]?.id ?? '');
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  // Only while you type the name: "/cl" shows it, "/click 3" doesn't.
  const update = () => {
    const typed = /^\/(\S*)$/.exec(input.value)?.[1]?.toLowerCase();
    const names = typed === undefined ? [] : Object.keys(commands).filter((name) => name.startsWith(typed));
    list.replaceChildren(...names.map((name) => {
      const row = Object.assign(document.createElement('li'), { id: `slash-${name}`, title: commands[name]!.help });
      row.setAttribute('role', 'option');
      row.dataset.name = name;
      row.append(
        Object.assign(document.createElement('span'), { className: 'slash-name', textContent: `/${name}` }),
        // The help without its usage part ("click <n|…> — click element n" shows "click element n").
        Object.assign(document.createElement('span'), { className: 'slash-help', textContent: commands[name]!.help.replace(/^.*? — /, '') }),
      );
      return row;
    }));
    if (!names.length) return close();
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    mark(0);
  };

  const pick = (name: string) => {
    input.value = `/${name} `;
    update(); // closes: the name is done
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', close);
  input.form!.addEventListener('submit', close);
  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;
    const name = rows()[at]!.dataset.name!;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') mark((at + (event.key === 'ArrowDown' ? 1 : rows().length - 1)) % rows().length);
    else if (event.key === 'Escape') close();
    // Enter on a name typed in full still runs it, as before the menu.
    else if (event.key === 'Tab' || (event.key === 'Enter' && input.value !== `/${name}`)) pick(name);
    else return;
    event.preventDefault();
  });

  list.addEventListener('mousedown', (event) => event.preventDefault()); // keeps focus in the box
  list.addEventListener('mousemove', (event) => {
    const row = (event.target as HTMLElement).closest('li');
    if (row && rows().indexOf(row) !== at) mark(rows().indexOf(row));
  });
  list.addEventListener('click', (event) => {
    const name = (event.target as HTMLElement).closest('li')?.dataset.name;
    if (name) pick(name);
  });
}
