// @ts-nocheck
import { c as _c } from "react/compiler-runtime";
import { marked, type Token, type Tokens } from 'marked';
import React, { useMemo, useRef } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, useTheme } from '../ink.js';
import { type CliHighlight, useCliHighlight } from '../utils/cliHighlight.js';
import { hashContent } from '../utils/hash.js';
import { configureMarked, formatToken } from '../utils/markdown.js';
import { stripPromptXMLTags } from '../utils/messages.js';
import { MarkdownTable } from './MarkdownTable.js';
type Props = {
  children: string;
  /** When true, render all text content as dim */
  dimColor?: boolean;
};

// Module-level token cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). useMemo doesn't survive unmount→remount, so
// scrolling back to a previously-visible message re-parses. Messages are
// immutable in history; same content → same tokens. Keyed by hash to avoid
// retaining full content strings (turn50→turn99 RSS regression, #24180).
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

// Characters that indicate markdown syntax. If none are present, skip the
// ~3ms marked.lexer call entirely — render as a single paragraph. Covers
// the majority of short assistant responses and user prompts that are
// plain sentences. Checked via indexOf (not regex) for speed.
// Single regex: matches any MD marker or ordered-list start (N. at line start).
// One pass instead of 10× includes scans.
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
function hasMarkdownSyntax(s: string): boolean {
  // Sample first 500 chars — if markdown exists it's usually early (headers,
  // code fence, list). Long tool outputs are mostly plain text tails.
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}
function cachedLexer(content: string): Token[] {
  // Fast path: plain text with no markdown syntax → single paragraph token.
  // Skips marked.lexer's full GFM parse (~3ms on long content). Not cached —
  // reconstruction is a single object allocation, and caching would retain
  // 4× content in raw/text fields plus the hash key for zero benefit.
  if (!hasMarkdownSyntax(content)) {
    return [{
      type: 'paragraph',
      raw: content,
      text: content,
      tokens: [{
        type: 'text',
        raw: content,
        text: content
      }]
    } as Token];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    // Promote to MRU — without this the eviction is FIFO (scrolling back to
    // an early message evicts the very item you're looking at).
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    // LRU-ish: drop oldest. Map preserves insertion order.
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Renders markdown content using a hybrid approach:
 * - Tables are rendered as React components with proper flexbox layout
 * - Other content is rendered as ANSI strings via formatToken
 */
export function Markdown(props) {
  const settings = useSettings();
  const highlight = useCliHighlight(!settings.syntaxHighlightingDisabled);
  return (
    <MarkdownBody
      {...props}
      highlight={settings.syntaxHighlightingDisabled ? null : highlight}
    />
  );
}
function MarkdownBody(t0) {
  const $ = _c(7);
  const {
    children,
    dimColor,
    highlight
  } = t0;
  const [theme] = useTheme();
  configureMarked();
  let elements;
  if ($[0] !== children || $[1] !== dimColor || $[2] !== highlight || $[3] !== theme) {
    const tokens = cachedLexer(stripPromptXMLTags(children));
    elements = [];
    let nonTableContent = "";
    const flushNonTableContent = function flushNonTableContent() {
      if (nonTableContent) {
        elements.push(<Ansi key={elements.length} dimColor={dimColor}>{nonTableContent.trim()}</Ansi>);
        nonTableContent = "";
      }
    };
    for (const token of tokens) {
      if (token.type === "table") {
        flushNonTableContent();
        elements.push(<MarkdownTable key={elements.length} token={token as Tokens.Table} highlight={highlight} />);
      } else {
        nonTableContent = nonTableContent + formatToken(token, theme, 0, null, null, highlight);
        nonTableContent;
      }
    }
    flushNonTableContent();
    $[0] = children;
    $[1] = dimColor;
    $[2] = highlight;
    $[3] = theme;
    $[4] = elements;
  } else {
    elements = $[4];
  }
  const elements_0 = elements;
  let t1;
  if ($[5] !== elements_0) {
    t1 = <Box flexDirection="column" gap={1}>{elements_0}</Box>;
    $[5] = elements_0;
    $[6] = t1;
  } else {
    t1 = $[6];
  }
  return t1;
}
type StreamingProps = {
  children: string;
};

// Once the unfinished tail passes this size it is frozen into its own chunk,
// so each delta only re-lexes/re-formats the last few KB. Without it a single
// long list (one top-level token that is always "the growing block") is
// re-parsed in full on every delta.
const FREEZE_LIMIT = 4096;
// Top-level list item start — the only mid-block cut we allow. Ordered lists
// keep their numbering because marked honors the start number of the cut.
const LIST_ITEM_START_RE = /\n(?=(?:[-*+]|\d{1,9}[.)]) )/g;
const FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})/gm;
type FrozenChunk = {
  text: string;
  /** Blank line before the next piece (true at a real block boundary). */
  gapAfter: boolean;
};

/**
 * Renders markdown during streaming by splitting at the last top-level block
 * boundary: everything before is stable (memoized, never re-parsed), only the
 * final block is re-parsed per delta. marked.lexer() correctly handles
 * unclosed code fences as a single token, so block boundaries are always safe.
 * Past FREEZE_LIMIT the stable prefix (or, for one oversized list, the
 * leading items) is frozen into immutable chunks.
 *
 * The boundaries only advance (monotonic), so ref mutation during render
 * is idempotent and safe under StrictMode double-rendering. Component unmounts
 * between turns (streamingText → null), resetting the ref.
 */
export function StreamingMarkdown({
  children
}: StreamingProps): React.ReactNode {
  // React Compiler: this component reads and writes the ref during render by
  // design (monotonic, idempotent under StrictMode double-render). Memoizing
  // around the ref reads would break the algorithm. Opt out.
  'use no memo';

  configureMarked();

  // Strip before boundary tracking so it matches <Markdown>'s stripping.
  // When a closing tag arrives, stripped(N+1) is not a prefix of stripped(N),
  // but the startsWith reset below handles that with a one-time re-lex.
  const stripped = stripPromptXMLTags(children);
  const stateRef = useRef({
    chunks: [] as FrozenChunk[],
    frozen: '',
    stablePrefix: ''
  });
  const state = stateRef.current;

  // Reset if text was replaced (defensive; normally unmount handles this)
  if (!stripped.startsWith(state.frozen)) {
    state.chunks = [];
    state.frozen = '';
    state.stablePrefix = '';
  }
  let rest = stripped.substring(state.frozen.length);
  if (!rest.startsWith(state.stablePrefix)) state.stablePrefix = '';

  // Lex only from current boundary — O(unstable length), not O(full text)
  const boundary = state.stablePrefix.length;
  const tokens = marked.lexer(rest.substring(boundary));

  // Last non-space token is the growing block; everything before is final
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += tokens[i]!.raw.length;
  }
  if (advance > 0) {
    state.stablePrefix = rest.substring(0, boundary + advance);
  }

  let cut = -1;
  let gapAfter = true;
  if (state.stablePrefix.length > FREEZE_LIMIT) {
    cut = state.stablePrefix.length;
  } else if (rest.length - state.stablePrefix.length > FREEZE_LIMIT) {
    // One oversized block (typically a long list): cut before its last
    // top-level item, unless that would land inside a code fence.
    let at = -1;
    for (const m of rest.substring(state.stablePrefix.length).matchAll(LIST_ITEM_START_RE)) {
      at = m.index! + 1;
    }
    if (at > 0) {
      const candidate = state.stablePrefix.length + at;
      const fences = rest.substring(0, candidate).match(FENCE_RE);
      if (!fences || fences.length % 2 === 0) {
        cut = candidate;
        gapAfter = false;
      }
    }
  }
  if (cut > 0) {
    state.chunks = [...state.chunks, { text: rest.substring(0, cut), gapAfter }];
    state.frozen += rest.substring(0, cut);
    state.stablePrefix = '';
    rest = stripped.substring(state.frozen.length);
  }

  const stablePrefix = state.stablePrefix;
  const unstableSuffix = rest.substring(stablePrefix.length);
  const last = state.chunks[state.chunks.length - 1];
  const gapBeforeRest = last?.gapAfter ? 1 : 0;

  // stablePrefix is memoized inside <Markdown> via useMemo([children, ...])
  // so it never re-parses as the unstable suffix grows
  return <Box flexDirection="column">
      {state.chunks.map((c, i) => <Box key={i} marginTop={i > 0 && state.chunks[i - 1]!.gapAfter ? 1 : 0}>
          <Markdown>{c.text}</Markdown>
        </Box>)}
      {stablePrefix && <Box marginTop={gapBeforeRest}><Markdown>{stablePrefix}</Markdown></Box>}
      {unstableSuffix && <Box marginTop={stablePrefix ? 1 : gapBeforeRest}><Markdown>{unstableSuffix}</Markdown></Box>}
    </Box>;
}
