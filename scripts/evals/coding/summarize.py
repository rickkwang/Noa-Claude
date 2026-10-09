#!/usr/bin/env python3
# Per-task summary of one or two coding eval runs. Reports counts per task, never a single overall score.
import json,statistics,sys
from pathlib import Path
def load(directory):
    manifest=json.loads((Path(directory)/'results.json').read_text())
    by_task={}
    for r in manifest['results']:by_task.setdefault(r['task'],[]).append(r)
    return manifest,by_task
def row(rs):
    accepted=sum(1 for r in rs if r['accepted'])
    tools=[r['tool_calls'] for r in rs]
    return f"{accepted}/{len(rs)}",statistics.median(tools) if tools else None,sum(r['trace']['tool_errors'] for r in rs)
runs=[load(d) for d in sys.argv[1:]]
if not runs:raise SystemExit('usage: summarize.py <artifacts_dir> [<artifacts_dir2>]')
lines=[]
for directory,(manifest,by_task) in zip(sys.argv[1:],runs):
    lines+=[f"## {Path(directory).name}",f"git {manifest.get('git_rev')} dirty={manifest.get('git_dirty')} provider={manifest.get('provider')} model={manifest.get('model')} goal={manifest.get('goal')}",'',"| task | accepted | median tool calls | tool errors |",'|---|---|---|---|']
    for task,rs in sorted(by_task.items()):
        acc,med,errs=row(rs)
        lines.append(f"| {task} | {acc} | {med} | {errs} |")
    lines.append('')
if len(runs)==2:
    (_,a),(_,b)=runs
    lines+=['## Comparison (accepted counts)','','| task | run A | run B |','|---|---|---|']
    for task in sorted(set(a)|set(b)):
        lines.append(f"| {task} | {row(a[task])[0] if task in a else '-'} | {row(b[task])[0] if task in b else '-'} |")
out='\n'.join(lines)+'\n'
(Path(sys.argv[1])/'summary.md').write_text(out)
print(out)
