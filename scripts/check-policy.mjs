// The Python importer uses the same validator as build, approval, and browser.
import {policy} from './policy.mjs';
import {checkContent,validatePolicy} from '../public/policy.mjs';
if (process.argv[2] === 'stage') {
  let input='';for await (const part of process.stdin) input+=part;
  const inputData=JSON.parse(input);const g=inputData.gallery;checkContent(g,validatePolicy(inputData.policy),g.pageCount);
} else console.log(JSON.stringify(policy));
