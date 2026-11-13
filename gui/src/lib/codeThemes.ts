export interface CodeThemeColors {
  keyword: string;
  string: string;
  number: string;
  type: string;
  title: string;
  builtIn: string;
  attr: string;
  variable: string;
  tag: string;
  meta: string;
  comment: string;
  commentStyle?: 'normal' | 'italic';
}

export interface CodeThemeDefinition {
  id: string;
  label: string;
  variant: 'light' | 'dark' | 'both';
  light?: CodeThemeColors;
  dark?: CodeThemeColors;
}

export const DEFAULT_CODE_THEME_ID = 'codex';

const CODEX_LIGHT: CodeThemeColors = {
  keyword: '#FF5F38',
  string: '#00C853',
  number: '#FF5F38',
  type: '#D28E73',
  title: 'var(--text-primary)',
  builtIn: 'var(--text-primary)',
  attr: 'var(--text-primary)',
  variable: 'var(--text-primary)',
  tag: 'var(--text-primary)',
  meta: 'var(--text-primary)',
  comment: '#939391',
  commentStyle: 'normal',
};

const CODEX_DARK: CodeThemeColors = {
  keyword: '#FF5F38',
  string: '#00C853',
  number: '#D28E73',
  type: '#D28E73',
  title: 'var(--text-primary)',
  builtIn: 'var(--text-primary)',
  attr: 'var(--text-primary)',
  variable: 'var(--text-primary)',
  tag: 'var(--text-primary)',
  meta: 'var(--text-primary)',
  comment: '#B2B2B0',
  commentStyle: 'normal',
};

export const CODE_THEMES: CodeThemeDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    variant: 'both',
    light: CODEX_LIGHT,
    dark: CODEX_DARK,
  },
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    variant: 'dark',
    dark: {
      keyword: '#FF7B72',
      string: '#A5D6FF',
      number: '#79C0FF',
      type: '#FFA657',
      title: '#D2A8FF',
      builtIn: '#79C0FF',
      attr: '#79C0FF',
      variable: '#FFA657',
      tag: '#7EE787',
      meta: '#8B949E',
      comment: '#8B949E',
      commentStyle: 'italic',
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    variant: 'light',
    light: {
      keyword: '#CF222E',
      string: '#0A3069',
      number: '#0550AE',
      type: '#953800',
      title: '#8250DF',
      builtIn: '#0550AE',
      attr: '#0550AE',
      variable: '#953800',
      tag: '#116329',
      meta: '#6E7781',
      comment: '#6E7781',
      commentStyle: 'italic',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    variant: 'dark',
    dark: {
      keyword: '#FF79C6',
      string: '#F1FA8C',
      number: '#BD93F9',
      type: '#8BE9FD',
      title: '#50FA7B',
      builtIn: '#8BE9FD',
      attr: '#50FA7B',
      variable: '#F8F8F2',
      tag: '#FF79C6',
      meta: '#6272A4',
      comment: '#6272A4',
      commentStyle: 'italic',
    },
  },
  {
    id: 'one-dark',
    label: 'One Dark',
    variant: 'dark',
    dark: {
      keyword: '#C678DD',
      string: '#98C379',
      number: '#D19A66',
      type: '#E5C07B',
      title: '#61AFEF',
      builtIn: '#E5C07B',
      attr: '#D19A66',
      variable: '#E06C75',
      tag: '#E06C75',
      meta: '#5C6370',
      comment: '#5C6370',
      commentStyle: 'italic',
    },
  },
  {
    id: 'one-light',
    label: 'One Light',
    variant: 'light',
    light: {
      keyword: '#A626A4',
      string: '#50A14F',
      number: '#986801',
      type: '#C18401',
      title: '#4078F2',
      builtIn: '#C18401',
      attr: '#986801',
      variable: '#E45649',
      tag: '#E45649',
      meta: '#A0A1A7',
      comment: '#A0A1A7',
      commentStyle: 'italic',
    },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    variant: 'dark',
    dark: {
      keyword: '#CBA6F7',
      string: '#A6E3A1',
      number: '#FAB387',
      type: '#F9E2AF',
      title: '#89B4FA',
      builtIn: '#F38BA8',
      attr: '#89B4FA',
      variable: '#CDD6F4',
      tag: '#89B4FA',
      meta: '#7F849C',
      comment: '#6C7086',
      commentStyle: 'italic',
    },
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    variant: 'light',
    light: {
      keyword: '#8839EF',
      string: '#40A02B',
      number: '#FE640B',
      type: '#DF8E1D',
      title: '#1E66F5',
      builtIn: '#D20F39',
      attr: '#1E66F5',
      variable: '#4C4F69',
      tag: '#1E66F5',
      meta: '#8C8FA1',
      comment: '#9CA0B0',
      commentStyle: 'italic',
    },
  },
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    variant: 'dark',
    dark: {
      keyword: '#FB4934',
      string: '#B8BB26',
      number: '#D3869B',
      type: '#FABD2F',
      title: '#8EC07C',
      builtIn: '#FE8019',
      attr: '#FABD2F',
      variable: '#83A598',
      tag: '#FB4934',
      meta: '#928374',
      comment: '#928374',
      commentStyle: 'italic',
    },
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light',
    variant: 'light',
    light: {
      keyword: '#9D0006',
      string: '#79740E',
      number: '#8F3F71',
      type: '#B57614',
      title: '#427B58',
      builtIn: '#AF3A03',
      attr: '#B57614',
      variable: '#076678',
      tag: '#9D0006',
      meta: '#928374',
      comment: '#928374',
      commentStyle: 'italic',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    variant: 'dark',
    dark: {
      keyword: '#81A1C1',
      string: '#A3BE8C',
      number: '#B48EAD',
      type: '#8FBCBB',
      title: '#88C0D0',
      builtIn: '#81A1C1',
      attr: '#8FBCBB',
      variable: '#D8DEE9',
      tag: '#81A1C1',
      meta: '#616E88',
      comment: '#616E88',
      commentStyle: 'italic',
    },
  },
  {
    id: 'monokai',
    label: 'Monokai',
    variant: 'dark',
    dark: {
      keyword: '#F92672',
      string: '#E6DB74',
      number: '#AE81FF',
      type: '#66D9EF',
      title: '#A6E22E',
      builtIn: '#66D9EF',
      attr: '#A6E22E',
      variable: '#F8F8F2',
      tag: '#F92672',
      meta: '#75715E',
      comment: '#75715E',
      commentStyle: 'italic',
    },
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    variant: 'dark',
    dark: {
      keyword: '#BB9AF7',
      string: '#9ECE6A',
      number: '#FF9E64',
      type: '#2AC3DE',
      title: '#7AA2F7',
      builtIn: '#7DCFFF',
      attr: '#73DACA',
      variable: '#C0CAF5',
      tag: '#F7768E',
      meta: '#565F89',
      comment: '#565F89',
      commentStyle: 'italic',
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    variant: 'light',
    light: {
      keyword: '#859900',
      string: '#2AA198',
      number: '#D33682',
      type: '#B58900',
      title: '#268BD2',
      builtIn: '#CB4B16',
      attr: '#268BD2',
      variable: '#657B83',
      tag: '#268BD2',
      meta: '#93A1A1',
      comment: '#93A1A1',
      commentStyle: 'italic',
    },
  },
];

export function isKnownCodeThemeId(id: string): boolean {
  return CODE_THEMES.some((theme) => theme.id === id);
}

export function getCodeThemeOptions(variant: 'light' | 'dark'): [string, string][] {
  return CODE_THEMES.filter((theme) => theme.variant === 'both' || theme.variant === variant).map((theme) => [
    theme.id,
    theme.label,
  ]);
}

export function resolveCodeTheme(
  codeThemeId: string | undefined,
  variant: 'light' | 'dark',
): { id: string; colors: CodeThemeColors } {
  const match = codeThemeId
    ? CODE_THEMES.find((theme) => theme.id === codeThemeId && (theme.variant === 'both' || theme.variant === variant))
    : undefined;
  const resolved = match ?? CODE_THEMES[0]!;
  const colors = (variant === 'dark' ? resolved.dark : resolved.light) ?? (variant === 'dark' ? CODEX_DARK : CODEX_LIGHT);
  return { id: resolved.id, colors };
}
