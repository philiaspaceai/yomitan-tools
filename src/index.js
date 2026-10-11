// Public API of yomitan-tools. Single entry point for AI agents.
//
//   import {openDictionary} from 'yomitan-tools';
//
//   const dict = await openDictionary('./jmdict.zip');
//   console.log(dict.title, dict.version);
//   console.log(await dict.validate());
//   const hits = await dict.searchTerms('打つ');
//   console.log(await dict.render(hits[0].ref));
//   await dict.close();
export {openDictionary, YomitanDictionary} from './dictionary.js';
export {validateDictionary, validateSingleEntry, detectVersion} from './validate.js';
export {renderEntry, renderTerm, renderKanji, renderTag, renderMeta} from './render.js';
export {splitTags, effectiveReading, classifyBankFile} from './constants.js';
