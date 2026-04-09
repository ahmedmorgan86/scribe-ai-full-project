/**
 * German function words for stylometric analysis.
 * Based on Burrows' Delta methodology for authorship attribution.
 *
 * German function words include articles, conjunctions, prepositions,
 * pronouns, and auxiliary verbs. Note that German has grammatical
 * cases affecting article forms (der/die/das, den/dem/des, etc.).
 */

export const GERMAN_FUNCTION_WORDS = [
  // Definite articles (all cases)
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',

  // Indefinite articles
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'eines',

  // Conjunctions
  'und',
  'oder',
  'aber',
  'denn',
  'sondern',
  'doch',
  'jedoch',
  'weder',
  'noch',

  // Prepositions
  'in',
  'an',
  'auf',
  'aus',
  'bei',
  'mit',
  'nach',
  'seit',
  'von',
  'zu',
  'für',
  'gegen',
  'durch',
  'ohne',
  'um',
  'über',
  'unter',
  'vor',
  'hinter',
  'neben',
  'zwischen',

  // Personal pronouns
  'ich',
  'du',
  'er',
  'sie',
  'es',
  'wir',
  'ihr',
  'mich',
  'dich',
  'ihn',
  'uns',
  'euch',
  'mir',
  'dir',
  'ihm',

  // Possessive pronouns
  'mein',
  'meine',
  'dein',
  'deine',
  'sein',
  'seine',
  'unser',
  'unsere',
  'euer',
  'eure',

  // Demonstrative pronouns
  'dieser',
  'diese',
  'dieses',
  'jener',
  'jene',
  'jenes',
  'solcher',
  'solche',
  'solches',

  // Relative pronouns
  'welcher',
  'welche',
  'welches',

  // Interrogative pronouns
  'wer',
  'was',
  'wem',
  'wen',
  'wessen',

  // Auxiliary and modal verbs
  'ist',
  'sind',
  'war',
  'waren',
  'sein',
  'bin',
  'bist',
  'seid',
  'hat',
  'haben',
  'hatte',
  'hatten',
  'wird',
  'werden',
  'wurde',
  'wurden',
  'kann',
  'können',
  'konnte',
  'konnten',
  'muss',
  'müssen',
  'musste',
  'mussten',
  'soll',
  'sollen',
  'sollte',
  'sollten',
  'will',
  'wollen',
  'wollte',
  'wollten',
  'darf',
  'dürfen',
  'durfte',
  'durften',
  'mag',
  'mögen',
  'mochte',
  'mochten',

  // Adverbs and particles
  'nicht',
  'auch',
  'noch',
  'schon',
  'nur',
  'so',
  'dann',
  'da',
  'hier',
  'dort',
  'jetzt',
  'immer',
  'sehr',
  'mehr',
  'als',
  'wie',
  'wenn',
  'weil',
  'dass',
  'ob',
  'wo',
  'wann',
  'warum',

  // Indefinite pronouns and determiners
  'man',
  'alle',
  'alles',
  'andere',
  'einige',
  'jeder',
  'jede',
  'jedes',
  'kein',
  'keine',
  'nichts',
  'etwas',
  'viel',
  'viele',
  'wenig',
  'wenige',
] as const;

export type GermanFunctionWord = (typeof GERMAN_FUNCTION_WORDS)[number];

export const GERMAN_LANGUAGE_CODE = 'de';

export interface GermanFunctionWordConfig {
  languageCode: typeof GERMAN_LANGUAGE_CODE;
  functionWords: readonly string[];
  subordinateMarkers: readonly string[];
}

export const GERMAN_SUBORDINATE_MARKERS = [
  'dass',
  'weil',
  'wenn',
  'ob',
  'obwohl',
  'obgleich',
  'während',
  'als',
  'nachdem',
  'bevor',
  'bis',
  'seit',
  'seitdem',
  'sobald',
  'solange',
  'falls',
  'sofern',
  'damit',
  'sodass',
  'indem',
  'wobei',
  'womit',
  'worauf',
] as const;

export const germanConfig: GermanFunctionWordConfig = {
  languageCode: GERMAN_LANGUAGE_CODE,
  functionWords: GERMAN_FUNCTION_WORDS,
  subordinateMarkers: GERMAN_SUBORDINATE_MARKERS,
};
