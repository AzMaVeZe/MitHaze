// מונה "משחקים ששוחקו" — כמה סבבים התחילו אי-פעם בכל חדרי המשחק.
// נשמר בקובץ מקומי כדי לשרוד הפעלות-מחדש רגילות (spin-down/crash) של התהליך,
// אבל יתאפס בכל Deploy חדש — לדיסק ב-Render אין persistence בין פריסות
// בתוכנית החינמית. אין כאן מסד נתונים אמיתי בכוונה, כמו בשאר הפרויקט.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, '..', 'data', 'stats.json');

function load() {
  try {
    if (existsSync(STATS_FILE)) {
      return JSON.parse(readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (_) { /* קובץ פגום/חסר — מתחילים מחדש */ }
  return { gamesPlayed: 0 };
}

let stats = load();

function save() {
  try {
    writeFileSync(STATS_FILE, JSON.stringify(stats));
  } catch (_) { /* דיסק לקריאה-בלבד וכו' — לא קריטי, ממשיכים בזיכרון */ }
}

export function incrementGamesPlayed() {
  stats.gamesPlayed += 1;
  save();
}

export function getStats() {
  return { ...stats };
}
