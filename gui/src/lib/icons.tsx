// Central icon mapping, all from Codex's icon set: its 16px light glyphs (glyphs.ts) and a few full-viewBox
// icons (codexIcons.ts), exported under the legacy lucide-react names so call sites are unchanged.
// To swap a shape, change its mapping here only.
import type { CSSProperties } from 'react';
import { GLYPHS } from './glyphs';
import { codexIcons, type CodexIconName } from './codexIcons';

type IconProps = { size?: number; className?: string; style?: CSSProperties };

// Codex icons carry their own viewBox; the size defaults to 16px to match the glyphs.
function codex(name: CodexIconName) {
  const { viewBox, body } = codexIcons[name];
  // React re-parses innerHTML whenever this object's identity changes, so build it once per icon.
  const html = { __html: body };
  return function CodexGlyph({ size = 16, className, style }: IconProps) {
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
export const Queue = codex("queue");
export const Steer = codex("steer");
export const BookOpen = glyph("book-open");
export const Bookmark = glyph("bookmark");
export const BookmarkFilled = glyph("bookmark-fill");
export const Check = glyph("checkmark-md");
export const CheckCircle2 = glyph("checkmark-circle");
export const ChevronDown = glyph("chevron-down-md");
export const ChevronLeft = glyph("chevron-left-md");
export const ChevronRight = glyph("chevron-right-md");
export const ChevronsUpDown = codex("arrow-up-arrow-down");
export const ChevronUp = glyph("chevron-up-md");
export const Edit2 = glyph("pencil");
export const Cloud = glyph("cloud");
export const Copy = glyph("square-on-square");
export const Download = glyph("arrow-down-line-horizontal");
export const ExternalLink = glyph("open-link");
export const Globe = codex("globe");
export const ArrowUpRight = glyph("arrow-up-right-md");
export const Eye = glyph("eye");
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
export const ListDetails = codex("list-bullet");
export const PanelBottom = codex("dock");
export const Filter = glyph("filter");
export const Folder = glyph("folder");
export const FolderOpen = glyph("folder-open");
export const FolderPlus = glyph("folder-badge-plus");
export const GitBranch = glyph("branch");
export const Tag = glyph("tag");
export const Code = glyph("code");
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
export const MessageCircle = codex("chat-bubble");
export const Gauge = codex("gauge");
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
