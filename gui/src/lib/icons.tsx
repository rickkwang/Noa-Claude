// Central icon mapping: 16px glyphs (glyphs.ts) and full-viewBox vector icons (vectorIcons.ts),
// exported under standard icon names so call sites are unchanged.
// To swap a shape, change its mapping here only.
import type { CSSProperties } from 'react';
import { GLYPHS } from './glyphs';
import { vectorIcons, type VectorIconName } from './vectorIcons';

type IconProps = { size?: number; className?: string; style?: CSSProperties };

// Vector icons carry their own viewBox; the size defaults to 16px to match the glyphs.
function vectorIcon(name: VectorIconName) {
  const { viewBox, body } = vectorIcons[name];
  // React re-parses innerHTML whenever this object's identity changes, so build it once per icon.
  const html = { __html: body };
  return function VectorGlyph({ size = 16, className, style }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={viewBox}
        fill="currentColor"
        className={className}
        style={style}
        aria-hidden="true"
        dangerouslySetInnerHTML={html}
      />
    );
  };
}

// Glyphs are filled 16px artwork, so stroke props don't apply.
function glyph(name: string, mirrored = false) {
  const html = { __html: GLYPHS[name]! };
  return function GlyphIcon({ size = 16, className, style }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="currentColor"
        className={className}
        style={mirrored ? { transform: "scaleX(-1)", ...style } : style}
        aria-hidden="true"
        dangerouslySetInnerHTML={html}
      />
    );
  };
}

export const AlertTriangle = glyph("exclamation-mark-triangle");
export const TextWrap = glyph("text-wrap");
export const TextOverflow = glyph("text-overflow");
export const ArrowUpDown = glyph("arrow-down-arrow-up");
export const Worktree = glyph("arrow-branch");
export const ArrowDown = glyph("arrow-down-md");
export const ArrowLeft = glyph("arrow-left-md");
export const ArrowRight = glyph("arrow-right-md");
export const Brain = vectorIcon("brain");
export const Queue = vectorIcon("queue");
export const Steer = vectorIcon("steer");
export const BookOpen = glyph("book-open");
export const Bookmark = glyph("bookmark");
export const BookmarkFilled = glyph("bookmark-fill");
export const Check = glyph("checkmark-md");
export const CheckCircle2 = glyph("checkmark-circle");
export const ChevronDown = glyph("chevron-down-md");
export const ChevronLeft = glyph("chevron-left-md");
export const ChevronRight = glyph("chevron-right-md");
export const ChevronsUpDown = vectorIcon("arrow-up-arrow-down");
export const ChevronUp = glyph("chevron-up-md");
export const Edit2 = glyph("pencil");
export const Copy = glyph("square-on-square");
export const Download = glyph("arrow-down-line-horizontal");
export const ExternalLink = glyph("open-link");
export const Globe = vectorIcon("globe");
export const ArrowUpRight = glyph("arrow-up-right-md");
export const Eye = glyph("eye");
export function EyeOff({ size = 16, className, style }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M6.59 6.59a2 2 0 0 0 2.82 2.82" />
      <path d="M10.73 10.73A6.8 6.8 0 0 1 8 11.33C4.8 11.33 2.4 8.9 1.33 8a11.3 11.3 0 0 1 2.75-2.88" />
      <path d="M6.4 4.82A6.5 6.5 0 0 1 8 4.67c3.2 0 5.6 2.43 6.67 3.33-.44.38-1.15 1.07-2.06 1.72" />
      <path d="M2 2l12 12" />
    </svg>
  );
}
export const FileText = glyph("document-text");
export const FileTypescript = glyph("file-ts");
export const FileReact = glyph("file-react");
export const FileJavascript = glyph("file-js");
export const FileJson = glyph("file-json");
export const FileMarkdown = glyph("file-markdown");
export const FileCss = glyph("file-css");
export const FileHtml = glyph("file-html");
export const FilePython = glyph("file-python");
export const Photo = glyph("photo");
export const ListDetails = vectorIcon("list-bullet");
export const PanelBottom = vectorIcon("dock");
export const Filter = glyph("filter");
export const Folder = glyph("folder");
export const FolderOpen = glyph("folder-open");
export const FolderPlus = glyph("folder-badge-plus");
export const GitBranch = glyph("branch");
export const Tag = glyph("tag");
export const Code = glyph("code");
export const Cloud = glyph("cloud");
export const Terminal = glyph("terminal");
export const Tool = glyph("wrench");
// The note rail toggle: a stack of cards, since the rail holds more than the calendar.
export const List = glyph("list-bullet");
export const Loader2 = glyph("spinner-quarter-graded");
export const MoreHorizontal = glyph("ellipsis-horizontal");
// The graph's "hide isolated nodes" toggle: linked nodes.
export const Palette = glyph("paint-palette");
export const Pin = glyph("pin");
export const PanelLeft = glyph("sidebar");
// Only a left sidebar glyph exists; the right panel toggle is its mirror.
export const PanelRight = glyph("sidebar", true);
export const Plug = glyph("plugin");
export const Plus = glyph("plus-md");
export const PlusMinus = glyph("plus-minus-square");
export const RefreshCcw = glyph("arrows-clockwise-rotate-lg");
export const RotateCcw = glyph("arrow-rotate-counterclockwise");
export const Search = glyph("magnifying-glass-md");
export const MessageCircle = vectorIcon("chat-bubble");
export const Gauge = vectorIcon("gauge");
export const Keyboard = glyph("keyboard");
export const Settings = glyph("gear");
export const SlidersHorizontal = glyph("sliders");
export const SquarePen = glyph("square-and-pencil");
export const Stop = glyph("stop-fill");
export const Trash2 = glyph("trash");
export const Link = glyph("link");
export const Users = glyph("person-2");
export const X = glyph("xmark-md");
export const ZoomIn = glyph("plus-md");
export const ZoomOut = glyph("minus-md");
