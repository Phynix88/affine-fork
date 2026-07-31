import test from 'ava';
import * as Y from 'yjs';

import { updateDocWithMarkdown } from '../../../native';

// Builds a minimal document containing one database block, mirroring the
// structure AFFiNE's own read-side test uses.
function createDocWithDatabase(): Buffer {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');

  const page = new Y.Map<unknown>();
  page.set('sys:id', 'page');
  page.set('sys:flavour', 'affine:page');
  const pageChildren = new Y.Array<string>();
  pageChildren.push(['note']);
  page.set('sys:children', pageChildren);
  page.set('prop:title', new Y.Text('Test'));
  blocks.set('page', page);

  const note = new Y.Map<unknown>();
  note.set('sys:id', 'note');
  note.set('sys:flavour', 'affine:note');
  const noteChildren = new Y.Array<string>();
  noteChildren.push(['db']);
  note.set('sys:children', noteChildren);
  note.set('prop:displayMode', 'page');
  blocks.set('note', note);

  const db = new Y.Map<unknown>();
  db.set('sys:id', 'db');
  db.set('sys:flavour', 'affine:database');
  db.set('sys:children', new Y.Array<string>());
  db.set('prop:title', new Y.Text('Aufgaben'));
  const columns = new Y.Array<unknown>();
  const column = new Y.Map<unknown>();
  column.set('id', 'status-col');
  column.set('name', 'Status');
  column.set('type', 'select');
  column.set('data', new Y.Map<unknown>());
  columns.push([column]);
  db.set('prop:columns', columns);
  db.set('prop:cells', new Y.Map<unknown>());
  blocks.set('db', db);

  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

// Documented behaviour as of v0.27.3: the native markdown writer has no
// handler for affine:database and rejects the whole document instead of
// rewriting it. That is the safe failure mode — nothing is written, so an
// existing database cannot be silently destroyed by a text update.
//
// The cost is that update_document is unusable on any document containing a
// database. Row writes must therefore go through appendDatabaseRow, which
// builds a Yjs update directly and never touches this parser.
test('markdown update refuses documents with a database block instead of corrupting them', t => {
  const before = createDocWithDatabase();

  const error = t.throws(() =>
    updateDocWithMarkdown(before, 'Neuer Fliesstext.', 'doc-1')
  );

  t.regex(
    String(error?.message),
    /unsupported block flavour: affine:database/,
    'the writer must fail loudly on database blocks'
  );

  // The source document must be readable and complete after the failed call.
  const untouched = new Y.Doc();
  Y.applyUpdate(untouched, before);
  const db = untouched.getMap<Y.Map<unknown>>('blocks').get('db');

  t.is(db?.get('sys:flavour'), 'affine:database');
  const columns = db?.get('prop:columns') as Y.Array<unknown> | undefined;
  t.is(columns?.length, 1, 'column definitions must remain intact');
});
