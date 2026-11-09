#!/usr/bin/env node
// Minimal state manager: polls, citizens, events, episode briefs. No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'state');
const load = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const save = (f, d) => writeFileSync(join(root, f), JSON.stringify(d, null, 2) + '\n');
const [cmd, sub, ...rest] = process.argv.slice(2);
const now = () => new Date().toISOString();
const stageFor = (n) => (n >= 100000 ? 4 : n >= 10000 ? 3 : n >= 1000 ? 2 : 1);

function usage() {
  console.log(`Commands:
  status
  followers <n>                          set today's follower count (= population)
  day                                    advance to next day
  poll open "<question>" "A|B|C"
  poll close <id> "<winner>" "A=120,B=300,C=45"
  citizen add <username> [title]
  citizen title <username> <title>
  set <key> <value>                      e.g. set name Valeria, set currency Lira
  event "<text>"
  episode                                print today's brief`);
}

const c = load('country.json');
const l = load('ledger.json');

switch (cmd) {
  case 'status':
    console.log(c, `\nopen polls: ${l.polls.filter((p) => p.status === 'open').length}, citizens: ${l.citizens.length}`);
    break;
  case 'followers':
    c.followers = Number(sub); c.stage = stageFor(c.followers); save('country.json', c);
    l.events.push({ at: now(), day: c.day, text: `Population snapshot: ${c.followers}` }); save('ledger.json', l);
    console.log(`Population ${c.followers}, stage ${c.stage}`);
    break;
  case 'day':
    c.day += 1; save('country.json', c); console.log(`Day ${c.day}`);
    break;
  case 'poll':
    if (sub === 'open') {
      const [q, opts] = rest;
      const id = l.polls.length + 1;
      l.polls.push({ id, day: c.day, question: q, options: opts.split('|'), status: 'open', opened: now() });
      save('ledger.json', l); console.log(`Poll #${id} opened`);
    } else if (sub === 'close') {
      const [id, winner, tally] = rest;
      const p = l.polls.find((x) => x.id === Number(id));
      if (!p) throw new Error('no such poll');
      Object.assign(p, { status: 'closed', winner, tally, closed: now() });
      save('ledger.json', l); console.log(`Poll #${id} closed: ${winner} (log the screenshot in evidence/)`);
    } else usage();
    break;
  case 'citizen':
    if (sub === 'add') {
      const [u, title] = rest;
      if (!l.citizens.find((x) => x.username === u)) l.citizens.push({ username: u, joinedDay: c.day, titles: title ? [title] : [] });
      save('ledger.json', l); console.log(`Citizen #${l.citizens.length}: ${u}`);
    } else if (sub === 'title') {
      const [u, t] = rest;
      const x = l.citizens.find((y) => y.username === u);
      if (!x) throw new Error('unknown citizen');
      x.titles.push(t); save('ledger.json', l); console.log(`${u}: ${t}`);
    } else usage();
    break;
  case 'set':
    c[sub] = rest.join(' '); save('country.json', c); console.log(`${sub} = ${c[sub]}`);
    break;
  case 'event':
    l.events.push({ at: now(), day: c.day, text: [sub, ...rest].join(' ') }); save('ledger.json', l); console.log('logged');
    break;
  case 'episode': {
    const last = [...l.polls].reverse().find((p) => p.status === 'closed');
    const open = [...l.polls].reverse().find((p) => p.status === 'open');
    console.log(`=== EPISODE BRIEF — Day ${c.day} ===
Country: ${c.name ?? '(unnamed)'} | Population: ${c.followers} (stage ${c.stage}) | Treasury: ${c.treasury} ${c.currency ?? ''}
HOOK:        [dramatic visual / event]
RECAP:       ${last ? `Poll #${last.id} "${last.question}" → ${last.winner} (${last.tally ?? ''}). Show screenshot.` : '(none yet)'}
CONSEQUENCE: [show winner on the map, cite grid cell]
NEW DECISION:${open ? ` Poll #${open.id}: ${open.question} [${open.options.join(' / ')}]` : ' [open one with: poll open]'}
CTA:         Comment your proposal. Follow to become a citizen. Day ${c.day + 1} tomorrow.
HUD:         Day ${c.day} | Pop ${c.followers} | Treasury ${c.treasury}`);
    break;
  }
  default:
    usage();
}
