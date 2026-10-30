// Operator-only import: deliberately not exposed as a web endpoint.
import {spawnSync} from 'node:child_process';
const result = spawnSync('python3',[new URL('./stage-gallery.py',import.meta.url).pathname,...process.argv.slice(2)],{stdio:'inherit'});
process.exit(result.status ?? 1);
