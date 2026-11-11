// Drives the real browser client against the real server (live retrieval) using the fake DOM.
// Run: node test/ui-smoke.mjs   — prints what a user would see. Requires network access.
import http from 'node:http';
import { createApp } from '../server/app.js';
import { installDom } from './helpers/fake-dom.mjs';

process.env.LOG_LEVEL = 'silent';
const app = createApp();
const server = http.createServer((req, res) => app.handle(req, res));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const dom = installDom(`http://127.0.0.1:${server.address().port}`);
await import('../public/app.js');
await new Promise((r) => setTimeout(r, 50));
const $ = (id) => document.getElementById(id);
const waitIdle = async (max = 40000) => { const t = Date.now(); await new Promise((r) => setTimeout(r, 30)); while (!$('stopBtn').hidden && Date.now() - t < max) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 30)); };
const ask = async (q) => { $('q').value = q; await $('askForm').fire('submit'); await waitIdle(); };
const lastBot = () => dom.find($('thread'), '.msg').filter((m) => m.classList.contains('bot')).pop();
const checks = [];
const check = (name, ok, info = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? ' — ' + info : ''}`); };

check('welcome screen with suggestions', dom.find($('thread'), '.suggest')[0].children.length === 6, dom.text(dom.find($('thread'), '.welcome')[0]).slice(0, 60));
await ask(process.argv[2] || 'Who invented the telephone?');
let bot = lastBot();
check('answer rendered', dom.find(bot, '.answer').length === 1, dom.text(dom.find(bot, '.answer')[0]).slice(0, 110));
check('activity summary shows real work', /Searched \d+ source/.test(dom.text(dom.find(bot, '.activity')[0])), dom.text(dom.find(bot, '.activity-summary')[0]));
check('all six stages reported done', dom.find(bot, '.stage').filter((s) => s.classList.contains('done')).length === 6);
check('citation chips present', dom.find(bot, '.cite').length > 0, `${dom.find(bot, '.cite').length} chips`);
check('source cards present', dom.find(bot, '.src').length > 0, dom.find(bot, '.src').map((s) => dom.text(s).slice(0, 30)).join(' | ').slice(0, 120));
check('confidence pill present', dom.find(bot, '.conf').length === 1, dom.text(dom.find(bot, '.conf')[0]));
check('chat title set from the question', dom.text($('chatTitle')).length > 5, dom.text($('chatTitle')));
await dom.find(bot, '.cite')[0].click();
check('citation opens the source drawer with passages', !$('drawer').hidden && /Address/.test(dom.text($('drawerBody'))), dom.text($('drawerTitle')).slice(0, 60));
await dom.find(bot, '.act').find((b) => /Research/.test(dom.text(b))).click();
check('research panel lists searches and pages', /Searches run/.test(dom.text($('drawerBody'))) && /Pages retrieved/.test(dom.text($('drawerBody'))) && /Evidence graph/.test(dom.text($('drawerBody'))));
await dom.find(bot, '.act').find((b) => /Copy/.test(dom.text(b))).click();
check('copy answer includes sources', /Sources\n\[1\]/.test(globalThis.__copied || ''));
await ask('When was he born?');
bot = lastBot();
check('follow-up resolved from context', /Understood as/.test(dom.text(bot)), dom.text(dom.find(bot, '.understood')[0] || bot).slice(0, 90));
check('follow-up answered', /18\d\d/.test(dom.text(dom.find(bot, '.answer')[0])), dom.text(dom.find(bot, '.answer')[0]).slice(0, 90));
await ask('what is 12 * (3 + 4)');
check('calculator answer without retrieval', /84/.test(dom.text(lastBot())) && dom.find(lastBot(), '.activity').length === 0, dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 60));
// stop mid-retrieval
$('q').value = 'Why is the sky blue?'; const p = $('askForm').fire('submit'); await new Promise((r) => setTimeout(r, 250)); await $('stopBtn').click(); await p; await waitIdle();
check('stop cancels retrieval', /Stopped/.test(dom.text(lastBot())), dom.text(lastBot()).slice(0, 70));
await $('openSettings').click(); await new Promise((r) => setTimeout(r, 300));
check('settings lists providers and memory controls', /Search depth/.test(dom.text($('modalBody'))) && /Wikipedia/.test(dom.text($('modalBody'))) && /Clear saved knowledge/.test(dom.text($('modalBody'))));
await $('openAbout').click();
check('about page states there is no language model', /no large language model/i.test(dom.text($('modalBody'))));
check('history lists the conversation', dom.find($('chatList'), '.chat-item').length === 1);
$('histSearch').value = 'zzzz'; await $('histSearch').fire('input', { target: $('histSearch') });
check('history search filters', dom.find($('chatList'), '.chat-item').length === 0);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
server.close(); app.engine.close();
process.exit(checks.every(Boolean) ? 0 : 1);
