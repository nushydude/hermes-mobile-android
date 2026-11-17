import { readFileSync, statSync } from 'node:fs';
import { summarize } from './timing-summary.mjs';

try {
  const paths=process.argv.slice(2);
  if (!paths.length || paths.length > 1000) throw new Error();
  const records=paths.map(path=>{if(statSync(path).size>1024*1024)throw new Error();return JSON.parse(readFileSync(path,'utf8'));});
  console.log(JSON.stringify(summarize(records),null,2));
} catch {
  console.error('Invalid or unreadable timing input.');
  process.exitCode=1;
}
