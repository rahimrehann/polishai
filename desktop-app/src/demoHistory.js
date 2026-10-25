// Development only (POLISHAI_DEMO=1): fills an empty history with made-up
// rewrites so the History screen can be looked at without real use.
const SAMPLES = [
  ["message", "Slack", "hey can u send me the file when ur free thx", "Hey, could you send me the file when you get a chance? Thanks!"],
  ["email", "Gmail", "need the q3 numbers by friday its urgent for the board", "Hi,\n\nCould you send me the Q3 numbers by Friday? They are urgent and needed for the board meeting.\n\nThanks,\n[Name]"],
  ["message", "Messages", "running 10 min late sorry traffic is crazy", "Running about 10 minutes late, sorry. Traffic is crazy right now."],
  ["email", "Gmail", "following up on my last note did u get a chance to look at the proposal", "Hi,\n\nI'm following up on my last note. Did you get a chance to look over the proposal?\n\nBest,\n[Name]"],
  ["message", "Slack", "can we move standup to 930 tmrw", "Can we move tomorrow's standup to 9:30?"],
  ["message", "Notes", "remember to book the dentist and call mum", "Don't forget to book the dentist and call Mum."],
  ["email", "Chrome", "i would like to apply for the ai engineering coop position at your company", "Hello,\n\nI would like to apply for the AI Engineering co-op position at your company. I've attached my resume and would welcome the chance to talk.\n\nThank you,\n[Name]"],
  ["message", "Slack", "just pushed the fix, can someone review when they have a sec", "Just pushed the fix. Could someone review it when they have a second?"],
  ["message", "Discord", "anyone wanna hop on a call and debug this together", "Does anyone want to hop on a call and debug this together?"],
  ["email", "Gmail", "sorry for the delay on this ill get you the draft by monday morning", "Hi,\n\nSorry for the delay. I'll send you the draft by Monday morning.\n\nBest,\n[Name]"],
  ["message", "Messages", "thanks so much for dinner it was great", "Thanks so much for dinner. It was great!"],
  ["email", "Chrome", "could you please confirm the interview time we discussed", "Hi,\n\nCould you please confirm the interview time we discussed?\n\nThanks,\n[Name]"],
];

function seedDemo(history, now = new Date()) {
  if (history.list({ limit: 1 }).length > 0) return false;
  const entries = [];
  for (let i = 0; i < 24; i++) {
    const [format, app, input, output] = SAMPLES[i % SAMPLES.length];
    const daysAgo = Math.floor((23 - i) / 3);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 9 + (i % 8), (i * 7) % 60, 0);
    if (at > now) at.setTime(now.getTime() - (24 - i) * 60000);
    entries.push({ format, app, input, output, at: at.toISOString() });
  }
  entries.sort((a, b) => a.at.localeCompare(b.at)).forEach((e) => history.add(e));
  return true;
}

// Seeds each account at most once per run, so clearing history stays cleared.
function createDemoSeeder({ history, getEmail }) {
  const seeded = new Set();
  return () => {
    const email = getEmail();
    if (!email || seeded.has(email)) return;
    seeded.add(email);
    seedDemo(history);
  };
}

module.exports = { seedDemo, createDemoSeeder };
