/**
 * Whisper's language names -> ISO-639-1 codes (as whisper.cpp's g_lang table has them).
 *
 * OpenAI's API and faster-whisper servers report a detected language as a code ("en"), but
 * whisper.cpp's server reports the full name ("english"). Transcripts store the code.
 */
const CODE_BY_NAME: Record<string, string> = {
  english: 'en', chinese: 'zh', german: 'de', spanish: 'es', russian: 'ru', korean: 'ko', french: 'fr',
  japanese: 'ja', portuguese: 'pt', turkish: 'tr', polish: 'pl', catalan: 'ca', dutch: 'nl', arabic: 'ar',
  swedish: 'sv', italian: 'it', indonesian: 'id', hindi: 'hi', finnish: 'fi', vietnamese: 'vi', hebrew: 'he',
  ukrainian: 'uk', greek: 'el', malay: 'ms', czech: 'cs', romanian: 'ro', danish: 'da', hungarian: 'hu', tamil: 'ta',
  norwegian: 'no', thai: 'th', urdu: 'ur', croatian: 'hr', bulgarian: 'bg', lithuanian: 'lt', latin: 'la',
  maori: 'mi', malayalam: 'ml', welsh: 'cy', slovak: 'sk', telugu: 'te', persian: 'fa', latvian: 'lv', bengali: 'bn',
  serbian: 'sr', azerbaijani: 'az', slovenian: 'sl', kannada: 'kn', estonian: 'et', macedonian: 'mk', breton: 'br',
  basque: 'eu', icelandic: 'is', armenian: 'hy', nepali: 'ne', mongolian: 'mn', bosnian: 'bs', kazakh: 'kk',
  albanian: 'sq', swahili: 'sw', galician: 'gl', marathi: 'mr', punjabi: 'pa', sinhala: 'si', khmer: 'km',
  shona: 'sn', yoruba: 'yo', somali: 'so', afrikaans: 'af', occitan: 'oc', georgian: 'ka', belarusian: 'be',
  tajik: 'tg', sindhi: 'sd', gujarati: 'gu', amharic: 'am', yiddish: 'yi', lao: 'lo', uzbek: 'uz', faroese: 'fo',
  'haitian creole': 'ht', pashto: 'ps', turkmen: 'tk', nynorsk: 'nn', maltese: 'mt', sanskrit: 'sa',
  luxembourgish: 'lb', myanmar: 'my', tibetan: 'bo', tagalog: 'tl', malagasy: 'mg', assamese: 'as', tatar: 'tt',
  hawaiian: 'haw', lingala: 'ln', hausa: 'ha', bashkir: 'ba', javanese: 'jw', sundanese: 'su', cantonese: 'yue',
};

const CODES = new Set(Object.values(CODE_BY_NAME));

/** A detected language as an ISO code: "english" -> "en", "en" -> "en"; anything else is kept as given (null when empty). */
export function languageCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (CODES.has(v)) return v;
  return CODE_BY_NAME[v] ?? value.trim().slice(0, 32);
}
