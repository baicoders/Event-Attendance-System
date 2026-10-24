import { parseImportSource } from './parseSource';

self.onmessage = async (event: MessageEvent<{ fileName: string; bytes: ArrayBuffer }>) => {
  try {
    self.postMessage({ source: await parseImportSource(event.data.fileName, event.data.bytes) });
  } catch (error) {
    self.postMessage({ error: error instanceof TypeError ? 'The file is not readable UTF-8 CSV or valid XLSX.' : error instanceof Error ? error.message : 'Unable to parse the file.' });
  }
};
