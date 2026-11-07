import { MEXICO_STATES, type MexicoState } from '../_types';

/**
 * Turns what the OS reverse geocoder calls a state into one of our `MEXICO_STATES`.
 *
 * iOS rarely returns the exact names in our list: it sends abbreviations ("Yuc.",
 * "Q.R.", "CDMX", "Méx."), official long names ("Veracruz de Ignacio de la Llave"),
 * or drops accents. An exact-match check silently failed for most of Mexico, so
 * "Usar mi ubicación" left the only required field empty.
 */

const OUTSIDE_MEXICO: MexicoState = 'Fuera de México';

/** Lowercase, no accents, no punctuation or spaces: "Q. Roo" → "qroo". */
function compact(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^mx-/, '') // ISO 3166-2 codes, e.g. "MX-YUC"
    .replace(/[^a-z]/g, '');
}

// Every variant we've seen or that Apple/Google document, keyed by `compact()`.
const ALIASES: Record<string, MexicoState> = {
  // Abbreviations (INEGI / postal) and ISO codes
  ags: 'Aguascalientes', agu: 'Aguascalientes',
  bc: 'Baja California', bcn: 'Baja California',
  bcs: 'Baja California Sur',
  camp: 'Campeche', cam: 'Campeche',
  chis: 'Chiapas', chp: 'Chiapas',
  chih: 'Chihuahua', chh: 'Chihuahua',
  coah: 'Coahuila', coa: 'Coahuila', coahuiladezaragoza: 'Coahuila',
  col: 'Colima',
  dgo: 'Durango', dur: 'Durango',
  gto: 'Guanajuato', gua: 'Guanajuato',
  gro: 'Guerrero',
  hgo: 'Hidalgo', hid: 'Hidalgo',
  jal: 'Jalisco',
  mich: 'Michoacán', mic: 'Michoacán', michoacandeocampo: 'Michoacán',
  mor: 'Morelos',
  nay: 'Nayarit',
  nl: 'Nuevo León', nle: 'Nuevo León',
  oax: 'Oaxaca',
  pue: 'Puebla',
  qro: 'Querétaro', que: 'Querétaro', queretarodearteaga: 'Querétaro',
  qroo: 'Quintana Roo', qr: 'Quintana Roo', roo: 'Quintana Roo',
  slp: 'San Luis Potosí',
  sin: 'Sinaloa',
  son: 'Sonora',
  tab: 'Tabasco',
  tamps: 'Tamaulipas', tam: 'Tamaulipas',
  tlax: 'Tlaxcala', tla: 'Tlaxcala',
  ver: 'Veracruz', veracruzdeignaciodelallave: 'Veracruz', veracruzllave: 'Veracruz',
  yuc: 'Yucatán',
  zac: 'Zacatecas',
  // The two "México" — the capital vs. the state that surrounds it.
  cdmx: 'Ciudad de México', cmx: 'Ciudad de México', df: 'Ciudad de México',
  distritofederal: 'Ciudad de México', mexicocity: 'Ciudad de México',
  mexico: 'Estado de México', mex: 'Estado de México', edomex: 'Estado de México',
  edomx: 'Estado de México', stateofmexico: 'Estado de México',
};

// Our own names match too ("Yucatan", "yucatán" → "Yucatán").
for (const state of MEXICO_STATES) {
  if (state !== OUTSIDE_MEXICO) ALIASES[compact(state)] = state;
}

export function matchMexicoState(address: {
  region?: string | null;
  isoCountryCode?: string | null;
}): MexicoState | null {
  const country = address.isoCountryCode?.toUpperCase();
  if (country && country !== 'MX') return OUTSIDE_MEXICO;

  const region = address.region?.trim();
  if (!region) return null;
  return ALIASES[compact(region)] ?? null;
}
