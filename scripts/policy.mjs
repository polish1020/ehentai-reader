import {readFile} from 'node:fs/promises';
import {validatePolicy} from '../public/policy.mjs';
export const policy = validatePolicy(JSON.parse(await readFile(new URL('../public/content-policy.json',import.meta.url),'utf8')));
