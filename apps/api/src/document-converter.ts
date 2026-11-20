import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail } from './domain.js';

let busy = false;
function convert(executable: string, args: string[], dir: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { detached: process.platform !== 'win32', stdio: 'ignore',
      env: { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8' } });
    const timer = setTimeout(() => {
      // LibreOffice may start a child process: terminate the whole group on timeout.
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* The process may have exited just before the timeout. */ }
    }, 30_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Converter unavailable')); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('Conversion failed')); });
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
    await convert(process.env.DOCUMENT_CONVERTER || 'soffice', [
      `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
      '--headless', '--norestore', '--nodefault', '--nolockcheck', '--convert-to', 'pdf', '--outdir', dir, input,
    ], dir);
    const pdf = await readFile(join(dir, 'document.pdf'));
    if (pdf.length > 5 * 1024 * 1024 || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
    return pdf;
  } catch {
    return fail(503, 'Не удалось сформировать PDF. Повторите просмотр; заявка не выдана');
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
}
