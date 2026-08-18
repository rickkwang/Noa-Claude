function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function getInteractiveSmokeCommand(platform: string, agentBin: string) {
  if (platform === 'linux') {
    return {
      command: 'timeout',
      args: [
        '3',
        '/usr/bin/script',
        '-q',
        '-c',
        `/bin/bash -lc ${shellQuote(agentBin)}`,
        '/dev/null',
      ],
    };
  }

  return {
    command: 'timeout',
    args: ['3', '/usr/bin/script', '-q', '/dev/null', '/bin/zsh', '-lc', agentBin],
  };
}
