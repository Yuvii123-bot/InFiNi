// A small conversational dataset with explicit, exact-question holdouts. The tiny model starts from scratch;
// its smaller tokenizer is trained on training examples only. No production model/channel is modified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDialogue, buildDataset } from './dataset.mjs';

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const HELD_OUT = [
  ['Hello!', 'greeting'], ['Good morning!', 'morning'], ['How are you?', 'wellbeing'],
  ['What is your name?', 'identity'], ['Nice to meet you.', 'meeting'], ['Thank you!', 'thanks'],
  ['Goodbye!', 'farewell'], ['Can you help me?', 'help'], ['What can you do?', 'capabilities'], ['Tell me a joke.', 'joke'],
  ['Hey, how is it going?', 'wellbeing'], ['What should I call you?', 'identity'], ['Can you assist me?', 'help'],
];
// Each lesson has multiple short wordings; identical replies make the task learnable for a tiny decoder.
export const LESSONS = [
  { intent: 'greeting', reply: 'Hi! How can I help?', train: ['Hey!', 'Hi!', 'Hello there.', 'Hey friend.', 'Hi friend.', 'Greetings!', 'Hello, friend.'] },
  { intent: 'morning', reply: 'Good morning!', train: ['Morning!', 'A good morning to you.', 'Have a good morning.', 'Hello this morning.', 'Morning to you.'] },
  { intent: 'wellbeing', reply: 'I am doing well, thanks. How are you?', train: ['How are you doing?', 'How is it going?', 'Are you doing well?', 'How do you feel?', 'Are you okay?'] },
  { intent: 'identity', reply: "I'm Infini.", train: ["What's your name?", 'Tell me your name.', 'Who are you?', 'Your name?', 'Please say your name.', 'May I know your name?'] },
  { intent: 'meeting', reply: 'It is nice to meet you too!', train: ['Glad to meet you.', 'Pleased to meet you.', 'It is nice meeting you.', 'Great to meet you.', 'Happy to meet you.'] },
  { intent: 'thanks', reply: 'Glad I could help!', train: ['Thanks!', 'Thank you so much.', 'Many thanks.', 'Thanks a lot.', 'I appreciate your help.'] },
  { intent: 'farewell', reply: 'Bye! See you later.', train: ['Bye!', 'See you later.', 'See you soon.', 'Farewell!', 'I have to go now.'] },
  { intent: 'help', reply: 'Yes! What do you need help with?', train: ['Please help me.', 'Could you help?', 'I need some help.', 'Will you help me?', 'I need your help.'] },
  { intent: 'capabilities', reply: 'I can chat and answer simple questions.', train: ['How can you help?', 'What are your abilities?', 'What do you do?', 'What are you able to do?', 'Tell me what you can do.'] },
  { intent: 'joke', reply: 'Why did the tomato blush? It saw the salad dressing!', train: ['Make me laugh.', 'Say something funny.', 'Do you know a joke?', 'Please share a joke.', 'Could you tell a joke?'] },
  { intent: 'sorry', reply: 'That is okay. We all make mistakes.', train: ['I am sorry.', 'Sorry about that.', 'I apologize.', 'Oops, my mistake.', 'Please forgive me.'] },
  { intent: 'question', reply: 'Sure! What is your question?', train: ['I have a question.', 'May I ask something?', 'Can I ask a question?', 'I want to ask you something.', 'Let me ask you a question.'] },
  { intent: 'confusion', reply: 'I can try to explain it more simply.', train: ['I am confused.', 'Please explain it again.', 'I do not understand.', 'Can you explain?', 'That is confusing.'] },
  { intent: 'night', reply: 'Good night! Rest well.', train: ['Night!', 'Sleep well.', 'Have a good night.', 'I am going to bed.', 'Wishing you a good night.'] },
  { intent: 'mood', reply: 'I am sorry you feel sad. Would you like to talk?', train: ['I feel sad.', 'I am feeling down.', 'I am unhappy.', 'I feel upset.', 'I am sad.'] },
];

export function makeTinyDialogue(source, repetitions = 65) {
  const reserved = new Set(HELD_OUT.map(([q]) => norm(q)));
  const curated = new Set(LESSONS.flatMap((l) => l.train.map(norm)));
  if ([...curated].some((q) => reserved.has(q))) throw Error('curated training question overlaps a held-out question');
  source.train = source.train.filter((c) => c.every(([q]) => !reserved.has(norm(q)) && !curated.has(norm(q))));
  source.val = source.val.filter((c) => c.every(([q]) => !curated.has(norm(q))));
  for (const lesson of LESSONS) for (const question of lesson.train) for (let i = 0; i < repetitions; i++) source.train.push([[question, lesson.reply, lesson.intent]]);
  // Evaluate on held-out phrasings; multiple questions can share the same intent/reply, but never the exact train prompt.
  for (const [q, intent] of HELD_OUT) source.val.push([[q, LESSONS.find((l) => l.intent === intent).reply, intent]]);
  const trainNames = new Set(source.train.flatMap((c) => c.map(([q]) => norm(q))));
  source.val = source.val.filter((c) => c.every(([q]) => !trainNames.has(norm(q))));
  source.probes = source.probes.filter((p) => !trainNames.has(norm(p.user)));
  source.stats = { ...source.stats, trainConversations: source.train.length, valConversations: source.val.length, valPhrasingsInTrain: 0 };
  return source;
}

export function buildTinyDataset(dir) {
  const dialogue = makeTinyDialogue(buildDialogue({ seed: 41, conversations: 30000 }));
  const config = { model: { vocab_size: 672 }, mixture: { dialogue: 1, fresh: 0, replay: 0, groundedShare: 0.35 } };
  const { manifest, tokenizer } = buildDataset({ dir, version: 'tiny75k-dialogue-v1', docs: [], cfg: config, tokenizer: null, context: 128, cycle: 'tiny75k-v1', seed: 177, dialogue });
  if (tokenizer.vocab_size !== 672) throw Error(`expected tokenizer size 672, got ${tokenizer.vocab_size}`);
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), JSON.stringify(tokenizer, null, 2));
  fs.writeFileSync(path.join(dir, 'heldout-greetings.json'), JSON.stringify(HELD_OUT.map(([question, intent]) => ({ question, intent })), null, 2));
  return { ...manifest, lessonPhrasings: LESSONS.reduce((n, l) => n + l.train.length, 0), heldoutGreetings: HELD_OUT.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('dataset output directory required');
  console.log(JSON.stringify(buildTinyDataset(process.argv[2])));
}
