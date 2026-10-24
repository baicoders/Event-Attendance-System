import type { ImportSource } from '../components/ImportSourceStep';
import { MAX_IMPORT_BYTES } from './contract';

/** Transfer file ownership to a short-lived worker so spreadsheet parsing cannot freeze the UI. */
export async function processImportFile(file: File): Promise<ImportSource> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('This file exceeds the 10 MiB upload limit.');
  const bytes = await file.arrayBuffer();
  const worker = new Worker(new URL('./source.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const done = () => { window.clearTimeout(timeout); worker.terminate(); };
    const timeout = window.setTimeout(() => { done(); reject(new Error('File parsing timed out. Check the spreadsheet and try again.')); }, 60_000);
    worker.onmessage = (event: MessageEvent<{ source?: ImportSource; error?: string }>) => {
      done();
      if (event.data.source) resolve(event.data.source);
      else reject(new Error(event.data.error || 'Unable to parse the file.'));
    };
    worker.onerror = () => { done(); reject(new Error('Unable to parse the file. Check the spreadsheet and try again.')); };
    worker.postMessage({ fileName: file.name, bytes }, [bytes]);
  });
}
