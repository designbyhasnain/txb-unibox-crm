import { readFile } from 'fs/promises';

async function analyze() {
  try {
    const data = await readFile('txb-logo.png');
    // Simple check for certain color markers if it's a common format
    // or just output the first few bytes to see if it's a known logo structure
    console.log('File size:', data.length);
    console.log('Headers:', data.slice(0, 24).toString('hex'));
  } catch (e) {
    console.error(e);
  }
}
analyze();
