// Drives the real browser client against the real server (live retrieval) using the fake DOM.
// Run: node test/ui-smoke.mjs   — prints what a user would see. Requires network access.
import http from 'node:http';
import { createApp } from '../server/app.js';
import { installDom } from './helpers/fake-dom.mjs';

process.env.LOG_LEVEL = 'silent';
// this run sends about twenty messages within seconds; the limiter itself is tested in bench/security.js
process.env.RATE_LIMIT_PER_MIN = process.env.RATE_LIMIT_PER_MIN || '120';
process.env.RATE_LIMIT_BURST = process.env.RATE_LIMIT_BURST || '40';
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
// --- the built-in brain: chat replies, chips, memory, skills (no retrieval involved)
await ask('hi');
let bot = lastBot();
check('greeting answered as chat, without a research panel', /INFINI AI/.test(dom.text(dom.find(bot, '.answer')[0])) && dom.find(bot, '.activity').length === 0 && dom.find(bot, '.src').length === 0, dom.text(dom.find(bot, '.answer')[0]).slice(0, 90));
check('suggestion chips offered', dom.find(bot, '.chip').length >= 2, dom.find(bot, '.chip').map((b) => dom.text(b)).join(' | '));
check('chat reply offers “Search the web instead”', dom.find(bot, '.act').some((b) => /Search the web instead/.test(b.attrs['aria-label'] || '')));
await dom.find(bot, '.chip').find((b) => /joke/i.test(dom.text(b))).click(); await waitIdle();
bot = lastBot();
check('tapping a chip sends it as the next message', dom.find($('thread'), '.msg').length === 4 && dom.text(dom.find(bot, '.answer')[0]).length > 20 && /built-in memory/.test(dom.text(dom.find(bot, '.origin')[0] || bot)), dom.text(dom.find(bot, '.answer')[0]).slice(0, 90));
await ask('my name is Yuv');
await ask('what is my name');
check('memory survives the round trip through the browser', /Yuv/.test(dom.text(dom.find(lastBot(), '.answer')[0])), dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 80));
await ask('what time is it');
check('clock skill uses the device time zone and is labelled', /\d{1,2}:\d\d (AM|PM)/.test(dom.text(lastBot())) && /built-in skill/.test(dom.text(dom.find(lastBot(), '.origin')[0] || lastBot())), dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 90));
await ask('can a penguin fly');
check('common-sense answer is labelled and can be checked on the web', /can't fly/.test(dom.text(lastBot())) && /common sense/.test(dom.text(dom.find(lastBot(), '.origin')[0] || lastBot())) && dom.find(lastBot(), '.chip').some((b) => /^Search the web: /.test(dom.text(b))), dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 80));
// "Search the web instead" on an earlier chat reply: that reply becomes a web answer in place, and the memory stays
const jokeMsg = dom.find($('thread'), '.msg').filter((m) => m.classList.contains('bot'))[1];
const before = dom.find($('thread'), '.msg').length;
await dom.find(jokeMsg, '.act').find((b) => /Search the web instead/.test(b.attrs['aria-label'] || '')).click(); await waitIdle();
check('“Search the web instead” redoes that reply with web retrieval, in place', dom.find($('thread'), '.msg').length === before && dom.find(jokeMsg, '.activity').length === 1 && /Searched \d+ source/.test(dom.text(dom.find(jokeMsg, '.activity')[0])) && dom.find(jokeMsg, '.origin').length === 0, dom.text(dom.find(jokeMsg, '.activity-summary')[0] || jokeMsg).slice(0, 80));
await ask('what is my name');
check('redoing an earlier reply does not erase what the brain remembers', /Yuv/.test(dom.text(dom.find(lastBot(), '.answer')[0])), dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 80));
$('newChat').click(); await new Promise((r) => setTimeout(r, 30));

// --- the web pipeline
await ask(process.argv[2] || 'Who invented the telephone?');
bot = lastBot();
check('answer rendered', dom.find(bot, '.answer').length === 1, dom.text(dom.find(bot, '.answer')[0]).slice(0, 110));
check('activity summary shows real work', /Searched \d+ source/.test(dom.text(dom.find(bot, '.activity')[0])), dom.text(dom.find(bot, '.activity-summary')[0]));
check('all six stages reported done', dom.find(bot, '.stage').filter((s) => s.classList.contains('done')).length === 6);
check('citation chips present', dom.find(bot, '.cite').length > 0, `${dom.find(bot, '.cite').length} chips`);
check('source cards present', dom.find(bot, '.src').length > 0, dom.find(bot, '.src').map((s) => dom.text(s).slice(0, 30)).join(' | ').slice(0, 120));
check('confidence pill present', dom.find(bot, '.conf').length === 1, dom.text(dom.find(bot, '.conf')[0]));
check('related questions offered as buttons, icons are inline SVG', dom.find(bot, '.rel').length > 0 && dom.find(bot, 'svg').length > 5, dom.find(bot, '.rel').map((b) => dom.text(b)).join(' | ').slice(0, 110));
check('chat title set from the question', dom.text($('chatTitle')).length > 5, dom.text($('chatTitle')));
await dom.find(bot, '.cite')[0].click();
check('citation opens the source drawer with passages', !$('drawer').hidden && /Address/.test(dom.text($('drawerBody'))), dom.text($('drawerTitle')).slice(0, 60));
await dom.find(bot, '.act').find((b) => /Research/.test(dom.text(b))).click();
check('research panel lists searches and pages', /Searches run/.test(dom.text($('drawerBody'))) && /Pages retrieved/.test(dom.text($('drawerBody'))) && /Evidence graph/.test(dom.text($('drawerBody'))));
await dom.find(bot, '.act').find((b) => /Copy/.test(dom.text(b))).click();
check('copy answer includes sources', /Sources\n\[1\]/.test(globalThis.__copied || ''));
// save the answer, then meet it again in another conversation that has its own memory
await dom.find(bot, '.act').find((b) => /^Save/.test(b.attrs['aria-label'] || '')).click(); await new Promise((r) => setTimeout(r, 30));
$('newChat').click(); await new Promise((r) => setTimeout(r, 30));
await ask('my name is Sita');
await ask(process.argv[2] || 'Who invented the telephone?');
check('a saved answer is reused and says so', /From your saved knowledge/.test(dom.text(lastBot())), dom.text(dom.find(lastBot(), '.cached-banner')[0] || lastBot()).slice(0, 70));
await ask('what is my name');
check('a reused saved answer keeps this conversation’s memory', /Sita/.test(dom.text(dom.find(lastBot(), '.answer')[0])) && !/Yuv/.test(dom.text(dom.find(lastBot(), '.answer')[0])), dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 80));
await ask(process.argv[2] || 'Who invented the telephone?');
bot = lastBot();
await ask('When was he born?');
bot = lastBot();
check('follow-up resolved from context', /Understood as/.test(dom.text(bot)), dom.text(dom.find(bot, '.understood')[0] || bot).slice(0, 90));
check('follow-up answered', /18\d\d/.test(dom.text(dom.find(bot, '.answer')[0])), dom.text(dom.find(bot, '.answer')[0]).slice(0, 90));
// a misspelled question: the brain repairs the spelling, the web pipeline answers what was meant, and the original stays one tap away
await ask('what si a quantum conputer');
bot = lastBot();
check('typos are understood before searching', /Understood as:\s*What is a quantum computer/i.test(dom.text(dom.find(bot, '.understood')[0] || bot)) && /quantum/i.test(dom.text(dom.find(bot, '.answer')[0])) && dom.find(bot, '.src').length > 0, dom.text(dom.find(bot, '.answer')[0]).slice(0, 100));
check('a repaired spelling offers “Search as typed”', dom.find(bot, '.as-typed').length === 1, dom.text(dom.find(bot, '.understood')[0] || bot).slice(0, 80));
await ask('what is 12 * (3 + 4)');
check('calculator answer without retrieval', /84/.test(dom.text(lastBot())) && dom.find(lastBot(), '.activity').length === 0, dom.text(dom.find(lastBot(), '.answer')[0]).slice(0, 60));
// stop mid-retrieval
$('q').value = 'Why is the sky blue?'; const p = $('askForm').fire('submit'); await new Promise((r) => setTimeout(r, 250)); await $('stopBtn').click(); await p; await waitIdle();
check('stop cancels retrieval', /Stopped/.test(dom.text(lastBot())), dom.text(lastBot()).slice(0, 70));
await $('openSettings').click(); await new Promise((r) => setTimeout(r, 300));
check('settings lists providers and memory controls', /Search depth/.test(dom.text($('modalBody'))) && /Wikipedia/.test(dom.text($('modalBody'))) && /Clear saved knowledge/.test(dom.text($('modalBody'))));
await $('openAbout').click();
check('about page states there is no language model, explains the brain and credits its open data', /no large language model/i.test(dom.text($('modalBody'))) && /not conscious/.test(dom.text($('modalBody'))) && /ConceptNet 5/.test(dom.text($('modalBody'))) && /WordNet/.test(dom.text($('modalBody'))));
check('history lists all three conversations', dom.find($('chatList'), '.chat-item').length === 3);
$('histSearch').value = 'zzzz'; await $('histSearch').fire('input', { target: $('histSearch') });
check('history search filters', dom.find($('chatList'), '.chat-item').length === 0);
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
server.close(); app.engine.close();
process.exit(checks.every(Boolean) ? 0 : 1);
