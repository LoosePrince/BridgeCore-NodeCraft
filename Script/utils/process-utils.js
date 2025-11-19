import { execFileSync } from 'child_process';

function getProcessListWindows() {
  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2'
      ],
      { encoding: 'utf8' }
    );
    const trimmed = output?.trim();
    if (!trimmed) {
      return [];
    }
    const parsed = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map((proc) => ({
        pid: Number(proc.ProcessId),
        ppid: Number(proc.ParentProcessId),
        name: proc.Name || '',
        command: proc.CommandLine || ''
      }))
      .filter((proc) => !Number.isNaN(proc.pid));
  } catch (error) {
    return [];
  }
}

function getProcessListUnix() {
  try {
    const output = execFileSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' });
    const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) {
          return null;
        }
        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          name: match[3] || '',
          command: match[4] || ''
        };
      })
      .filter(Boolean);
  } catch (error) {
    return [];
  }
}

function buildProcessIndexes(list) {
  const byPid = new Map();
  const children = new Map();
  for (const proc of list) {
    byPid.set(proc.pid, proc);
    if (!children.has(proc.ppid)) {
      children.set(proc.ppid, []);
    }
    children.get(proc.ppid).push(proc);
  }
  return { byPid, children };
}

function isJavaProcess(proc) {
  if (!proc) {
    return false;
  }
  const name = (proc.name || '').toLowerCase();
  const command = (proc.command || '').toLowerCase();
  return name.includes('java') || command.includes('java');
}

function findJavaDescendantPid(rootPid, indexes) {
  if (!indexes) {
    return null;
  }
  const queue = [rootPid];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    const children = indexes.children.get(current) || [];
    for (const child of children) {
      if (visited.has(child.pid)) {
        continue;
      }
      visited.add(child.pid);
      if (isJavaProcess(child)) {
        return child.pid;
      }
      queue.push(child.pid);
    }
  }
  return null;
}

export function resolveAttachableJavaPid(rootPid) {
  const numericPid = Number(rootPid);
  if (!numericPid || Number.isNaN(numericPid)) {
    return null;
  }

  const list = process.platform === 'win32' ? getProcessListWindows() : getProcessListUnix();
  if (!list.length) {
    return numericPid;
  }
  const indexes = buildProcessIndexes(list);
  const rootProc = indexes.byPid.get(numericPid);
  if (isJavaProcess(rootProc)) {
    return numericPid;
  }
  const childJavaPid = findJavaDescendantPid(numericPid, indexes);
  return childJavaPid || numericPid;
}


