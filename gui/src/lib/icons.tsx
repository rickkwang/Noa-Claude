// Central icon mapping: Tabler Icons (plus a hand-drawn ChevronsDownUp) exported under the
// legacy lucide-react names so call sites are unchanged. To swap a shape, change its mapping here only.
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconAlignLeft,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconArrowsDownUp,
  IconBook,
  IconBookmark,
  IconBookmarkFilled,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCircleArrowUp,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDatabase,
  IconDeviceDesktop,
  IconDice5,
  IconDots,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFileText,
  IconBrandTypescript,
  IconBrandReact,
  IconBrandJavascript,
  IconJson,
  IconMarkdown,
  IconBrandCss3,
  IconBrandHtml5,
  IconBrandPython,
  IconPhoto,
  IconListDetails,
  IconFileZip,
  IconFilter,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconInfoCircle,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconLink,
  IconList,
  IconLoader2,
  IconMoon,
  IconPalette,
  IconPencil,
  IconPin,
  IconPinned,
  IconPlayerStop,
  IconPlug,
  IconPlus,
  IconPlusMinus,
  IconRefresh,
  IconSearch,
  IconSelector,
  IconServer,
  IconKeyboard,
  IconSettings,
  IconSquareCheck,
  IconStack2,
  IconSun,
  IconTag,
  IconTerminal2,
  IconTool,
  IconTopologyStar3,
  IconTrash,
  IconUnlink,
  IconUpload,
  IconUsers,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import type { Icon, IconProps } from '@tabler/icons-react';

// Default to 24px with a 1.5 stroke; call sites that need a heavier glyph pass their own stroke.
function icon(Cmp: Icon) {
  return function WrappedIcon(props: IconProps) {
    return <Cmp size={24} stroke={1.5} {...props} />;
  };
}

export const AlertTriangle = icon(IconAlertTriangle);
export const AlignLeft = icon(IconAlignLeft);
export const ArrowUpDown = icon(IconArrowsDownUp);
export const ArrowDown = icon(IconArrowDown);
export const ArrowLeft = icon(IconArrowLeft);
export const ArrowRight = icon(IconArrowRight);
export const BookOpen = icon(IconBook);
export const Bookmark = icon(IconBookmark);
export const BookmarkFilled = icon(IconBookmarkFilled);
export const Calendar = icon(IconCalendar);
export const Check = icon(IconCheck);
export const CheckCircle2 = icon(IconCircleCheck);
export const CheckSquare = icon(IconSquareCheck);
export const ChevronDown = icon(IconChevronDown);
export const ChevronLeft = icon(IconChevronLeft);
export const ChevronRight = icon(IconChevronRight);
export const ChevronsUpDown = icon(IconSelector);
// Inward twin of ChevronsUpDown ("collapse all folders"), drawn by hand because
// Tabler has no such glyph: same 256 grid, 16-unit stroke (1.5 at 24px), carets flipped.
export function ChevronsDownUp({ size = 24, className, style }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <polyline points="80 32 128 80 176 32" />
      <polyline points="80 224 128 176 176 224" />
    </svg>
  );
}
export const ChevronUp = icon(IconChevronUp);
export const CircleArrowUp = icon(IconCircleArrowUp);
// The editor's outline and edit-mode toggles.
export const Outline = icon(IconList);
export const Edit2 = icon(IconPencil);
export const Clock = icon(IconClock);
export const Copy = icon(IconCopy);
export const Database = icon(IconDatabase);
export const Dices = icon(IconDice5);
export const Download = icon(IconDownload);
export const ExternalLink = icon(IconExternalLink);
export const Eye = icon(IconEye);
export const FileArchive = icon(IconFileZip);
export const FileText = icon(IconFileText);
export const BrandTypescript = icon(IconBrandTypescript);
export const BrandReact = icon(IconBrandReact);
export const BrandJavascript = icon(IconBrandJavascript);
export const Json = icon(IconJson);
export const Markdown = icon(IconMarkdown);
export const BrandCss3 = icon(IconBrandCss3);
export const BrandHtml5 = icon(IconBrandHtml5);
export const BrandPython = icon(IconBrandPython);
export const Photo = icon(IconPhoto);
export const ListDetails = icon(IconListDetails);
export const Filter = icon(IconFilter);
export const Folder = icon(IconFolder);
export const FolderOpen = icon(IconFolderOpen);
export const FolderPlus = icon(IconFolderPlus);
export const GitBranch = icon(IconGitBranch);
export const Tag = icon(IconTag);
export const Terminal = icon(IconTerminal2);
export const Tool = icon(IconTool);
export const HardDrive = icon(IconServer);
export const Info = icon(IconInfoCircle);
// The note rail toggle: a stack of cards, since the rail holds more than the calendar.
export const Layers = icon(IconStack2);
export const List = icon(IconList);
export const Loader2 = icon(IconLoader2);
export const Maximize2 = icon(IconArrowsDiagonal);
export const Minimize2 = icon(IconArrowsDiagonalMinimize2);
export const Monitor = icon(IconDeviceDesktop);
export const Moon = icon(IconMoon);
export const MoreHorizontal = icon(IconDots);
// The graph's "hide isolated nodes" toggle: linked nodes, not Tabler's globe-on-a-stand network.
export const Network = icon(IconTopologyStar3);
export const Palette = icon(IconPalette);
export const Pin = icon(IconPin);
export const PinFilled = icon(IconPinned);
export const PanelLeft = icon(IconLayoutSidebar);
export const PanelRight = icon(IconLayoutSidebarRight);
export const Plug = icon(IconPlug);
export const Plus = icon(IconPlus);
export const PlusMinus = icon(IconPlusMinus);
export const RefreshCcw = icon(IconRefresh);
export const RotateCcw = icon(IconArrowBackUp);
export const Search = icon(IconSearch);
export const Keyboard = icon(IconKeyboard);
export const Settings = icon(IconSettings);
export const SlidersHorizontal = icon(IconAdjustmentsHorizontal);
export const Sun = icon(IconSun);
export const SquarePen = icon(IconEdit);
export const Stop = icon(IconPlayerStop);
export const Trash2 = icon(IconTrash);
export const Link = icon(IconLink);
export const Unlink = icon(IconUnlink);
export const Upload = icon(IconUpload);
export const Users = icon(IconUsers);
export const X = icon(IconX);
export const ZoomIn = icon(IconZoomIn);
export const ZoomOut = icon(IconZoomOut);
