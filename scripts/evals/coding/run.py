#!/usr/bin/env python3
import argparse,hashlib,json,os,re,shlex,signal,subprocess,tempfile,textwrap,time
from pathlib import Path
parser=argparse.ArgumentParser(description='Opt-in real-model coding acceptance checks; no fabricated model responses.')
parser.add_argument('--entry',default=str(Path(__file__).resolve().parents[3]/'dist/cli'))
parser.add_argument('--label',default='noa')
parser.add_argument('--reps',type=int,default=1)
parser.add_argument('--case',choices=['duration','merge'])
parser.add_argument('--check-fixtures',action='store_true',help='No API calls: require broken inputs to fail and known-correct references to pass.')
parser.add_argument('--goal',action='store_true',help='Run the real Noa QueryEngine with existing Goal verify; not applicable to CC.')
parser.add_argument('--max-turns',type=int,default=10)
parser.add_argument('--timeout',type=int,default=180)
parser.add_argument('--artifacts',default=None)
args=parser.parse_args()
cases_path=Path(__file__).with_name('cases.json')
tasks=json.loads(cases_path.read_text())
if args.case: tasks={args.case:tasks[args.case]}
def judge_source(task,directory,marker):
    # The marker is written only after the judge body returns normally; candidate code can't print or exit its way past it.
    return 'import sys\nsys.path.insert(0, '+repr(str(directory))+')\ntry:\n'+textwrap.indent(task['judge'],'    ')+'\nexcept SystemExit as error:\n    raise AssertionError("candidate exited before acceptance finished") from error\nopen('+repr(str(marker))+',"w").write("JUDGE_OK")\n'
def judge_ok(result,marker):
    return result.returncode==0 and marker.exists() and marker.read_text()=='JUDGE_OK'
if args.check_fixtures:
    # Forged output: prints the success line, flushes, and exits before the marker is written.
    forged='import os,sys\nprint("JUDGE_OK")\nsys.stdout.flush()\nos._exit(0)\n'
    for name,task in tasks.items():
        with tempfile.TemporaryDirectory(prefix='noa-checker-') as directory:
            marker=Path(directory)/'judge.ok'
            target=Path(directory)/task['module']
            def grade(code):
                target.write_text(code);marker.unlink(missing_ok=True)
                run=subprocess.run(['python3','-c',judge_source(task,directory,marker)],cwd=directory,capture_output=True,text=True)
                return judge_ok(run,marker)
            if grade(task['code']) or not grade(task['reference']) or grade('import sys; sys.exit(0)') or grade(forged): raise SystemExit('invalid checker: '+name)
            print('CHECKER_OK '+name)
    raise SystemExit(0)
config=Path(os.environ.get('CLAUDE_CONFIG_DIR',str(Path.home()/'.noa')))
profiles=json.loads((config/'provider-profiles.json').read_text())
p=next(x for x in profiles if x.get('active'))
root=Path(args.artifacts) if args.artifacts else Path(tempfile.mkdtemp(prefix='noa-coding-eval-'))
root.mkdir(parents=True,exist_ok=True)
base_env={k:os.environ[k] for k in ['PATH','TMPDIR','USER','LOGNAME','LANG','SHELL'] if k in os.environ}
base_env.update(ANTHROPIC_BASE_URL=p['baseUrl'],ANTHROPIC_AUTH_TOKEN=p['apiKey'],ANTHROPIC_MODEL=p['model'],ANTHROPIC_DEFAULT_OPUS_MODEL=p['model'],ANTHROPIC_DEFAULT_SONNET_MODEL=p['model'],ANTHROPIC_DEFAULT_HAIKU_MODEL=p['model'],CLAUDE_CODE_SUBAGENT_MODEL=p['model'],MAX_THINKING_TOKENS='0',CLAUDE_CODE_MAX_RETRIES='1',DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_TELEMETRY='1')
def run_one(label,binary,name,repeat):
    task=tasks[name];d=root/f'{name}-{repeat}-{label}';d.mkdir()
    (d/task['module']).write_text(task['code']);(d/'public_check.py').write_text(task['public']);(d/'README.md').write_text(task['spec'])
    env=dict(base_env,HOME=str(d/'home'),CLAUDE_CONFIG_DIR=str(d/'config'))
    prompt='Complete the task specified in README.md in this isolated fixture directory. Fix the existing implementation with the smallest correct change. Do not change README.md or public_check.py. Use only standard library. Run the public check before reporting completion. Stay within this directory.'
    cli_args=[binary,'--bare','--print','--output-format','stream-json','--verbose','--model',p['model'],'--tools','Read,Grep,Glob,Write,Edit,Bash','--allowedTools','Read,Grep,Glob,Write,Edit,Bash','--permission-mode','dontAsk','--max-turns',str(args.max_turns),'--no-session-persistence']
    check=root/'checks'/f'{name}-{repeat}-{label}.py';marker=check.with_suffix('.ok');check.parent.mkdir(exist_ok=True)
    if args.goal:
        check.write_text(judge_source(task,d,marker))

        cli_args=['bun',str(Path(__file__).with_name('goal-entry.ts')),str(d),'python3 '+shlex.quote(str(check)),str(args.max_turns)]
        env['NODE_ENV']='development'
        env['USER_TYPE']='external'
    start=time.monotonic();timed_out=False
    child=subprocess.Popen(cli_args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=d,env=env,start_new_session=os.name!='nt')
    try:stdout,stderr=child.communicate(prompt,timeout=args.timeout)
    except subprocess.TimeoutExpired:
        timed_out=True
        try:
            if os.name=='nt':child.kill()
            else:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        stdout,stderr=child.communicate()
    stdout=stdout.replace(p['apiKey'],'[REDACTED]');stderr=stderr.replace(p['apiKey'],'[REDACTED]')
    (d/'stdout.jsonl').write_text(stdout);(d/'stderr.txt').write_text(stderr)
    final=None;tools=[];tool_results=[];served_models=[]
    for line in stdout.splitlines():
        try:m=json.loads(line)
        except ValueError:continue
        if m.get('type')=='result':final=m
        if m.get('type')=='assistant':
            tools += [x for x in m.get('message',{}).get('content',[]) if x.get('type')=='tool_use']
            served_models.append(m.get('message',{}).get('model'))
        if m.get('type')=='user' and isinstance(m.get('message',{}).get('content'),list):
            tool_results += [x for x in m['message']['content'] if x.get('type')=='tool_result']
    # Ordinary runs are judged only after exit; Goal runs may read the independent check.
    marker.unlink(missing_ok=True)
    try:judge=subprocess.run(['python3','-c',judge_source(task,d,marker)],cwd=d,text=True,capture_output=True,timeout=10)
    except subprocess.TimeoutExpired:judge=subprocess.CompletedProcess([],124,'','independent check timed out')
    try:unchanged=(d/'README.md').read_text()==task['spec'] and (d/'public_check.py').read_text()==task['public'] and (not args.goal or check.read_text()==judge_source(task,d,marker))
    except OSError:unchanged=False
    public_ids={t['id'] for t in tools if t['name']=='Bash' and re.search(r'\bpython(?:3)?\b.*public_check\.py',str(t.get('input',{}).get('command','')),re.S)}
    public_test_observed=any(r['tool_use_id'] in public_ids and not r.get('is_error') and re.search(r'(?m)^PUBLIC_OK\s*$',r.get('content','') if isinstance(r.get('content'),str) else '\n'.join(b.get('text','') for b in r.get('content',[]) if isinstance(b,dict))) for r in tool_results)
    result={'cli':label,'task':name,'repeat':repeat,'exit':child.returncode,'timeout':timed_out,'seconds':round(time.monotonic()-start,2),'judge_passed':judge_ok(judge,marker) and unchanged,'served_models':sorted({m for m in served_models if m and m!='<synthetic>'}),'public_test_observed':public_test_observed,'tool_calls':len(tools),'terminal':{k:final.get(k) for k in ['subtype','is_error','terminal_reason','num_turns','usage','modelUsage']} if final else None,'judge_error':judge.stderr[-1500:],'final_text':final.get('result') if final else None,'goal_status':json.loads((d/'goal-state.json').read_text()).get('status') if args.goal and (d/'goal-state.json').exists() else None}
    result['accepted']=result['judge_passed'] and result['exit']==0 and not (result['terminal'] or {}).get('is_error',True) and result['public_test_observed'] and (result['goal_status']=='complete' if args.goal else True)
    (d/'judge.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({k:result[k] for k in ['cli','task','repeat','judge_passed','public_test_observed','seconds','tool_calls','exit']},ensure_ascii=False),flush=True)
    return result
results=[]
for repeat in range(1,args.reps+1):
    for name in tasks:
        result=run_one(args.label,args.entry,name,repeat)
        results.append(result)
        manifest={'provider':p['name'],'model':p['model'],'entry':args.entry,'entry_sha256':hashlib.sha256(Path(args.entry).read_bytes()).hexdigest(),'goal':args.goal,'fixture_sha256':hashlib.sha256(cases_path.read_bytes()).hexdigest(),'results':results}
        (root/'results.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print('Evidence: '+str(root),flush=True)
raise SystemExit(0 if all(r['accepted'] for r in results) else 1)
