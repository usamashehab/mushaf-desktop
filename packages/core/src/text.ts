const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export const toArabicDigits = (n: number | string) =>
  String(n).replace(/\d/g, d => ARABIC_DIGITS[Number(d)] ?? d)

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits to ASCII, so "٢:٢٥٥" reads like "2:255". */
export const toLatinDigits = (text: string) =>
  text
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))

// Harakat, Quranic annotation marks, superscript alef and tatweel.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g

/**
 * Arabic for matching, not for display: no marks, one alef, ى as ي, ة as ه.
 * "البَقَرَةِ" and "البقره" both become "البقره".
 */
export const foldArabic = (text: string) =>
  text
    .replace(MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()

/** Latin names for matching: "Al-Baqarah" becomes "albaqarah". */
export const foldLatin = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
