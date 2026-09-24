// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import type { StructuredPatchHunk } from 'diff';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useRegisterOverlay } from '../../context/overlayContext.js';
import { type DiffData, useDiffData } from '../../hooks/useDiffData.js';
import { type TurnDiff, useTurnDiffs } from '../../hooks/useTurnDiffs.js';
import { Box, Text } from '../../ink.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { useModalScrollRef } from '../../context/modalContext.js';
import { jumpBy } from '../ScrollKeybindingHandler.js';
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js';
import type { Message } from '../../types/message.js';
import { plural } from '../../utils/stringUtils.js';
import { Byline } from '../design-system/Byline.js';
import { Dialog } from '../design-system/Dialog.js';
import { LoadingState } from '../design-system/LoadingState.js';
import { Tab, Tabs } from '../design-system/Tabs.js';
import { DiffDetailView } from './DiffDetailView.js';
import { DiffFileList } from './DiffFileList.js';
type Props = {
  messages: Message[];
  onDone: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type ViewMode = 'list' | 'detail';
type DetailScrollAction = 'up' | 'down' | 'pageUp' | 'pageDown' | 'fullPageUp' | 'fullPageDown' | 'top' | 'bottom';
type DiffSource = {
  type: 'current';
} | {
  type: 'turn';
  turn: TurnDiff;
};
function turnDiffToDiffData(turn: TurnDiff): DiffData {
  const files = Array.from(turn.files.values()).map(f => ({
    path: f.filePath,
    linesAdded: f.linesAdded,
    linesRemoved: f.linesRemoved,
    isBinary: false,
    isLargeFile: false,
    isTruncated: false,
    isNewFile: f.isNewFile
  })).sort((a, b) => a.path.localeCompare(b.path));
  const hunks = new Map<string, StructuredPatchHunk[]>();
  for (const f of turn.files.values()) {
    hunks.set(f.filePath, f.hunks);
  }
  return {
    stats: {
      filesCount: turn.stats.filesChanged,
      linesAdded: turn.stats.linesAdded,
      linesRemoved: turn.stats.linesRemoved
    },
    files,
    hunks,
    loading: false,
    source: {
      kind: 'working-tree'
    },
    baseMode: 'auto'
  };
}
export function DiffDialog(t0) {
  const $ = _c(74);
  const {
    messages,
    onDone
  } = t0;
  const gitDiffData = useDiffData();
  const turnDiffs = useTurnDiffs(messages);
  const [viewMode, setViewMode] = useState("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sourceIndex, setSourceIndex] = useState(0);
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = {
      type: "current"
    };
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== turnDiffs) {
    t2 = [t1, ...turnDiffs.map(_temp)];
    $[1] = turnDiffs;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  const sources = t2;
  const currentSource = sources[sourceIndex];
  const currentTurn = currentSource?.type === "turn" ? currentSource.turn : null;
  let t3;
  if ($[3] !== currentTurn || $[4] !== gitDiffData) {
    t3 = currentTurn ? turnDiffToDiffData(currentTurn) : gitDiffData;
    $[3] = currentTurn;
    $[4] = gitDiffData;
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  const diffData = t3;
  const selectedFile = diffData.files[selectedIndex];
  let t4;
  if ($[6] !== diffData.hunks || $[7] !== selectedFile) {
    t4 = selectedFile ? diffData.hunks.get(selectedFile.path) || [] : [];
    $[6] = diffData.hunks;
    $[7] = selectedFile;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  const selectedHunks = t4;
  let t5;
  let t6;
  if ($[9] !== sourceIndex || $[10] !== sources.length) {
    t5 = () => {
      if (sourceIndex >= sources.length) {
        setSourceIndex(Math.max(0, sources.length - 1));
      }
    };
    t6 = [sources.length, sourceIndex];
    $[9] = sourceIndex;
    $[10] = sources.length;
    $[11] = t5;
    $[12] = t6;
  } else {
    t5 = $[11];
    t6 = $[12];
  }
  useEffect(t5, t6);
  const prevSourceIndex = useRef(sourceIndex);
  let t7;
  let t8;
  if ($[13] !== sourceIndex) {
    t7 = () => {
      if (prevSourceIndex.current !== sourceIndex) {
        setSelectedIndex(0);
        prevSourceIndex.current = sourceIndex;
      }
    };
    t8 = [sourceIndex];
    $[13] = sourceIndex;
    $[14] = t7;
    $[15] = t8;
  } else {
    t7 = $[14];
    t8 = $[15];
  }
  useEffect(t7, t8);
  useRegisterOverlay("diff-dialog");
  // Detail view scrolls inside the modal's ScrollBox (Tabs attaches it). Null
  // outside fullscreen, where the terminal's own scrollback does the job.
  const modalScrollRef = useModalScrollRef();
  const scrollDetail = (action: DetailScrollAction) => {
    const s = modalScrollRef?.current;
    if (viewMode !== "detail" || !s) return false;
    const half = Math.max(1, Math.floor(s.getViewportHeight() / 2));
    const full = Math.max(1, s.getViewportHeight());
    switch (action) {
      case "up":
        s.scrollBy(-1);
        break;
      case "down":
        s.scrollBy(1);
        break;
      case "pageUp":
        jumpBy(s, -half);
        break;
      case "pageDown":
        jumpBy(s, half);
        break;
      case "fullPageUp":
        jumpBy(s, -full);
        break;
      case "fullPageDown":
        jumpBy(s, full);
        break;
      case "top":
        s.scrollTo(0);
        break;
      case "bottom":
        s.scrollToBottom();
    }
  };
  useKeybindings({
    "diff:previousSource": () => {
      if (viewMode === "detail") {
        setViewMode("list");
      } else if (sources.length > 1) {
        setSourceIndex(prev => (prev - 1 + sources.length) % sources.length);
      }
    },
    "diff:nextSource": () => {
      if (viewMode === "list" && sources.length > 1) {
        setSourceIndex(prev_0 => (prev_0 + 1) % sources.length);
      }
    },
    "diff:back": () => {
      if (viewMode === "detail") {
        setViewMode("list");
      }
    },
    "diff:viewDetails": () => {
      if (viewMode === "list" && selectedFile) {
        modalScrollRef?.current?.scrollTo(0);
        setViewMode("detail");
      }
    },
    "diff:previousFile": () => {
      if (viewMode === "detail") return scrollDetail("up");
      setSelectedIndex(_temp3);
    },
    "diff:nextFile": () => {
      if (viewMode === "detail") return scrollDetail("down");
      setSelectedIndex(prev_2 => Math.min(diffData.files.length - 1, prev_2 + 1));
    },
    "scroll:pageUp": () => scrollDetail("pageUp"),
    "scroll:pageDown": () => scrollDetail("pageDown"),
    "scroll:fullPageUp": () => scrollDetail("fullPageUp"),
    "scroll:fullPageDown": () => scrollDetail("fullPageDown"),
    "scroll:top": () => scrollDetail("top"),
    "scroll:bottom": () => scrollDetail("bottom")
  }, {
    context: "DiffDialog"
  });
  let t17;
  if ($[38] !== diffData.stats) {
    t17 = diffData.stats ? <Text dimColor={true}>{diffData.stats.filesCount} {plural(diffData.stats.filesCount, "file")}{" "}changed{diffData.stats.linesAdded > 0 && <Text color="diffAddedWord"> +{diffData.stats.linesAdded}</Text>}{diffData.stats.linesRemoved > 0 && <Text color="diffRemovedWord"> -{diffData.stats.linesRemoved}</Text>}</Text> : null;
    $[38] = diffData.stats;
    $[39] = t17;
  } else {
    t17 = $[39];
  }
  const subtitle = t17;
  const noCommits = !currentTurn && diffData.noCommits === true;
  const branchSource = !currentTurn && diffData.source.kind === "branch" ? diffData.source : null;
  const headerTitle = currentTurn ? `Turn ${currentTurn.turnIndex}` : noCommits ? "Staged and new files" : branchSource ? "Branch changes" : "Uncommitted changes";
  const headerSubtitle = currentTurn ? currentTurn.userPromptPreview ? `"${currentTurn.userPromptPreview}"` : "" : noCommits ? "(no commits yet)" : branchSource ? `(vs ${branchSource.baseBranch})` : "(git diff HEAD)";
  const dismissShortcut = useShortcutDisplay("diff:dismiss", "DiffDialog", "esc");
  let t19;
  bb0: {
    if (currentTurn) {
      t19 = "No file changes in this turn";
      break bb0;
    }
    if (diffData.stats && diffData.stats.filesCount > 0 && diffData.files.length === 0) {
      t19 = "Too many files to display details";
      break bb0;
    }
    t19 = "No changes yet";
  }
  const emptyMessage = t19;
  let t20;
  if ($[43] !== headerSubtitle) {
    t20 = headerSubtitle && <Text dimColor={true}> {headerSubtitle}</Text>;
    $[43] = headerSubtitle;
    $[44] = t20;
  } else {
    t20 = $[44];
  }
  let t21;
  if ($[45] !== headerTitle || $[46] !== t20) {
    t21 = <Text>{headerTitle}{t20}</Text>;
    $[45] = headerTitle;
    $[46] = t20;
    $[47] = t21;
  } else {
    t21 = $[47];
  }
  const title = t21;
  let t22;
  if ($[48] !== onDone || $[49] !== viewMode) {
    t22 = function handleCancel() {
      if (viewMode === "detail") {
        setViewMode("list");
      } else {
        onDone("Diff dialog dismissed", {
          display: "system"
        });
      }
    };
    $[48] = onDone;
    $[49] = viewMode;
    $[50] = t22;
  } else {
    t22 = $[50];
  }
  const handleCancel = t22;
  let t23;
  if ($[51] !== dismissShortcut || $[52] !== sources.length || $[53] !== viewMode || $[16] !== modalScrollRef) {
    t23 = exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : viewMode === "list" ? <Byline>{sources.length > 1 && <Text>←/→ source</Text>}<Text>↑/↓ select</Text><Text>Enter view</Text><Text>{dismissShortcut} close</Text></Byline> : <Byline>{modalScrollRef && <Text>↑/↓ scroll</Text>}<Text>← back</Text><Text>{dismissShortcut} close</Text></Byline>;
    $[51] = dismissShortcut;
    $[52] = sources.length;
    $[53] = viewMode;
    $[16] = modalScrollRef;
    $[54] = t23;
  } else {
    t23 = $[54];
  }
  let t24;
  if ($[55] !== diffData.files || $[56] !== emptyMessage || $[73] !== diffData.loading || $[57] !== selectedFile?.isBinary || $[58] !== selectedFile?.isLargeFile || $[59] !== selectedFile?.isTruncated || $[60] !== selectedFile?.isUntracked || $[61] !== selectedFile?.path || $[62] !== selectedHunks || $[63] !== selectedIndex || $[64] !== viewMode) {
    t24 = diffData.files.length === 0 ? <Box marginTop={1}>{diffData.loading ? <LoadingState message="Loading diff…" dimColor /> : <Text dimColor={true}>{emptyMessage}</Text>}</Box> : viewMode === "list" ? <Box flexDirection="column" marginTop={1}><DiffFileList files={diffData.files} selectedIndex={selectedIndex} /></Box> : <Box flexDirection="column" marginTop={1}><DiffDetailView filePath={selectedFile?.path || ""} hunks={selectedHunks} isLargeFile={selectedFile?.isLargeFile} isBinary={selectedFile?.isBinary} isTruncated={selectedFile?.isTruncated} isUntracked={selectedFile?.isUntracked} /></Box>;
    $[55] = diffData.files;
    $[56] = emptyMessage;
    $[73] = diffData.loading;
    $[57] = selectedFile?.isBinary;
    $[58] = selectedFile?.isLargeFile;
    $[59] = selectedFile?.isTruncated;
    $[60] = selectedFile?.isUntracked;
    $[61] = selectedFile?.path;
    $[62] = selectedHunks;
    $[63] = selectedIndex;
    $[64] = viewMode;
    $[65] = t24;
  } else {
    t24 = $[65];
  }
  // Every source renders the same content; Tabs shows only the selected one
  // and, inside a fullscreen modal, wraps it in the ScrollBox detail scrolling
  // drives. Tabs owns ←/→/tab in list mode; detail mode hands ← to diff:back.
  const content = <Box flexDirection="column">{subtitle}{t24}</Box>;
  return <Dialog title={title} onCancel={handleCancel} color="background" inputGuide={t23}><Tabs title={undefined} hidden={sources.length <= 1} selectedTab={String(sourceIndex)} onTabChange={id => setSourceIndex(Number(id))} disableNavigation={viewMode === "detail"}>{sources.map((source, i) => <Tab key={i} id={String(i)} title={source.type === "current" ? "Current" : `T${source.turn.turnIndex}`}>{content}</Tab>)}</Tabs></Dialog>;
}
function _temp3(prev_1) {
  return Math.max(0, prev_1 - 1);
}
function _temp(turn) {
  return {
    type: "turn",
    turn
  };
}
