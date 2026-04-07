import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { getLauncherBootstrapCode } from './launcher-config.js';

const outfile = resolve('./dist/main.js');

console.log('Building Claude Agent...');

await new Promise<void>((resolve, reject) => {
  const args = ['build', './src/main.tsx', '--target', 'bun', '--outfile', outfile];
  if (process.argv.includes('--minify')) args.push('--minify');
  
  const proc = spawn('bun', args, { stdio: 'inherit' });
  
  proc.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`Build failed with code ${code}`));
  });
});

const content = readFileSync(outfile, 'utf-8');
writeFileSync(outfile, content + '\n' + getLauncherBootstrapCode());
console.log(`Build complete: ${outfile}`);
