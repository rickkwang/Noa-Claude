import type { ThemeFontFace } from '../types';

export interface LocalFontFamily {
  family: string;
  faces: ThemeFontFace[];
  /** Every face shares an advance width, measured with the canvas; the code font list only offers these. */
  monospaced: boolean;
}

type FontDataLike = {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
};

type QueryLocalFonts = () => Promise<FontDataLike[]>;

let familiesPromise: Promise<LocalFontFamily[]> | undefined;

function queryLocalFonts(): QueryLocalFonts | undefined {
  return (window as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
}

/** Enumerates installed font families and their faces. The API only exists in the desktop shell. */
export function loadFontFamilies(): Promise<LocalFontFamily[]> {
  familiesPromise ??= (async () => {
    const query = queryLocalFonts();
    if (!query) return [];
    try {
      const fonts = await query();
      const grouped = new Map<string, ThemeFontFace[]>();
      for (const font of fonts) {
        const faces = grouped.get(font.family) ?? [];
        faces.push({ family: font.family, fullName: font.fullName, postscriptName: font.postscriptName, style: font.style });
        grouped.set(font.family, faces);
      }
      return [...grouped.entries()]
        .map(([family, faces]) => ({ family, faces: faces.sort(byFaceWeight), monospaced: isMonospacedFamily(family) }))
        .sort((a, b) => a.family.localeCompare(b.family));
    } catch {
      return [];
    }
  })();
  return familiesPromise;
}

/** Synthetic family for one selected face, so the exact face renders instead of the family default. */
export function faceFamilyName(face: ThemeFontFace): string {
  return `noa-face-${face.postscriptName.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * Declares a selected face through the platform's own `local()` lookup: no font file needs loading, and
 * it works before any user gesture. Full name resolves on macOS; the PostScript name is the fallback.
 */
export function faceFontFaceRule(face: ThemeFontFace): string {
  const sources = [face.fullName, face.postscriptName]
    .filter(Boolean)
    .map((name) => `local(${quoteFamily(name)})`)
    .join(', ');
  return `@font-face { font-family: ${quoteFamily(faceFamilyName(face))}; src: ${sources}; font-weight: 400; font-style: normal; }`;
}

const FACE_ORDER = ['thin', 'ultralight', 'extralight', 'light', 'regular', 'normal', 'book', 'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy'];

/** Light to heavy, upright before italic: the platform returns faces in no particular order. */
function byFaceWeight(a: ThemeFontFace, b: ThemeFontFace): number {
  return faceRank(a) - faceRank(b) || a.fullName.localeCompare(b.fullName);
}

/** The face's style name: the font's own `style` when recorded, else what follows the family in its full name. */
export function faceStyle(face: ThemeFontFace): string {
  if (face.style?.trim()) return face.style.trim();
  const suffix = face.fullName.toLowerCase().startsWith(face.family.toLowerCase())
    ? face.fullName.slice(face.family.length).trim()
    : face.fullName;
  return suffix || 'Regular';
}

/** The upright default face: a family's regular is often not named "Regular" (Helvetica Neue's is just "Helvetica Neue"). */
export function isRegularFace(face: ThemeFontFace): boolean {
  return /^(regular|normal|roman|book)$/i.test(faceStyle(face));
}

function faceRank(face: ThemeFontFace): number {
  const style = faceStyle(face).toLowerCase();
  const weight = FACE_ORDER.findIndex((name) => style.includes(name));
  return (weight < 0 ? 4 : weight) * 2 + (/italic|oblique/.test(style) ? 1 : 0);
}

let probeContext: CanvasRenderingContext2D | null | undefined;

/** One context for every family: creating a canvas per family made the scan about forty times slower. */
function isMonospacedFamily(family: string): boolean {
  probeContext ??= document.createElement('canvas').getContext('2d');
  const context = probeContext;
  if (!context) return false;
  context.font = `16px ${quoteFamily(family)}`;
  const width = (text: string) => context.measureText(text).width;
  const wide = width('MMMMMMMMMM');
  return Math.abs(width('iiiiiiiiii') - wide) < 0.5 && Math.abs(width('0000000000') - wide) < 0.5;
}

/** Family names reach CSS through a style element; quote to keep punctuation from ending the declaration. */
export function quoteFamily(family: string): string {
  return `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
