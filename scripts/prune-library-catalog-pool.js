const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = 'netlify/data/library-catalog-pool.json';
const input = process.argv[2] || DEFAULT_INPUT;
const output = process.argv[3] || input;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function compactEntry(entry) {
  const aladin = entry.aladin || {};
  const next = {
    isbn: entry.isbn || '',
    title: entry.title || '',
    author: entry.author || '',
    meta: Array.isArray(entry.meta) ? entry.meta : [],
    cover: entry.cover || '',
    collection: entry.collection || '',
    collectionKeys: Array.isArray(entry.collectionKeys) ? entry.collectionKeys : [],
    collectionTags: Array.isArray(entry.collectionTags) ? entry.collectionTags : [],
    catalogUrl: entry.catalogUrl || '',
    ranks: entry.ranks || {},
    aladin: {
      categoryName: aladin.categoryName || '',
      link: aladin.link || '',
      cover: aladin.cover || '',
    },
  };

  return next;
}

function main() {
  const source = path.resolve(input);
  const target = path.resolve(output);
  const entries = readJson(source);
  if (!Array.isArray(entries)) throw new Error('Catalog pool must be a JSON array.');

  const beforeBytes = fs.statSync(source).size;
  const compact = entries
    .filter(entry => entry && entry.aladin && entry.aladin.categoryName)
    .map(compactEntry);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(compact, null, 2)}\n`);

  const afterBytes = fs.statSync(target).size;
  console.log(JSON.stringify({
    input,
    output,
    beforeCount: entries.length,
    afterCount: compact.length,
    beforeBytes,
    afterBytes,
    savedBytes: beforeBytes - afterBytes,
  }, null, 2));
}

main();
