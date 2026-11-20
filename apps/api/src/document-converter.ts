import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DomainError, fail } from './domain.js';

let busy = false;
let lastResult: string | null = null;
class ConversionError extends Error {
  constructor(readonly code: string) { super(code); }
}
async function cgroupValue(path: string) {
  return readFile(path, 'utf8').then(value => value.trim()).catch(() => null);
}
export async function converterDiagnostics() {
  const [cpu, memory, used, quotaV1, periodV1, memoryV1, usedV1] = await Promise.all([
    cgroupValue('/sys/fs/cgroup/cpu.max'), cgroupValue('/sys/fs/cgroup/memory.max'), cgroupValue('/sys/fs/cgroup/memory.current'),
    cgroupValue('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'), cgroupValue('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    cgroupValue('/sys/fs/cgroup/memory/memory.limit_in_bytes'), cgroupValue('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
  ]);
  const [quota, period] = cpu ? cpu.split(/\s+/).map(Number) : [Number(quotaV1), Number(periodV1)];
  const mib = (value: string | null) => value && /^\d+$/.test(value) && Number(value) < 2 ** 60 ? Math.round(Number(value) / 1048576) : null;
  return { busy, lastResult, cpuLimitMillicores: quota && quota > 0 && period && Number.isFinite(quota) ? Math.round(quota / period * 1000) : null,
    memoryLimitMiB: mib(memory ?? memoryV1), memoryUsedMiB: mib(used ?? usedV1) };
}
function convert(executable: string, args: string[], dir: string) {
  return new Promise<void>((resolve, reject) => {
    let timedOut = false;
    const child = spawn(executable, args, { detached: process.platform !== 'win32', stdio: 'ignore',
      env: { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8' } });
    const timer = setTimeout(() => {
      timedOut = true;
      // LibreOffice may start a child process: terminate the whole group on timeout.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* The process may have exited just before the timeout. */ }
    }, 60_000);
    child.once('error', error => {
      clearTimeout(timer);
      const code = (error as NodeJS.ErrnoException).code;
      reject(new ConversionError(code === 'ENOENT' ? 'DOCUMENT_CONVERTER_MISSING' : 'DOCUMENT_CONVERTER_START_FAILED'));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ConversionError(timedOut ? 'DOCUMENT_CONVERTER_TIMEOUT' : signal ? 'DOCUMENT_CONVERTER_SIGNAL' : 'DOCUMENT_CONVERTER_EXIT_' + (Number.isInteger(code) ? code : 'UNKNOWN')));
    });
  });
}
/** One converter per server; no shell, database transaction, or credentials in child env. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  if (busy) fail(503, 'Готовится другой документ. Повторите просмотр через несколько секунд');
  busy = true;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), 'mukpid-document-'));
    const input = join(dir, 'document.docx');
    await writeFile(input, docx, { mode: 0o600 });
    let conversionError: unknown;
    try { await convert(process.env.DOCUMENT_CONVERTER || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
      '--headless', '--norestore', '--nodefault', '--nolockcheck', '--convert-to', 'pdf', '--outdir', dir, input,
    ], dir); } catch (error) { conversionError = error; }
    // LibreOffice can report a failed exit after successfully writing the PDF.
    const pdf = await readFile(join(dir, 'document.pdf')).catch(() => { throw conversionError ?? new ConversionError('DOCUMENT_OUTPUT_MISSING'); });
    if (pdf.length > 5 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-' || !/%%EOF\s*$/.test(pdf.subarray(-1024).toString())) throw conversionError ?? new ConversionError('DOCUMENT_OUTPUT_INVALID');
    lastResult = 'OK';
    return pdf;
  } catch (error) {
    lastResult = error instanceof ConversionError ? error.code : 'DOCUMENT_CONVERTER_ERROR';
    throw new DomainError(503, lastResult, 'Не удалось сформировать PDF. Повторите просмотр; заявка не выдана');
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
}
