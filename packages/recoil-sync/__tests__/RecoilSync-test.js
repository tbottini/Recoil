/**
 * Copyright (c) Facebook, Inc. and its affiliates. Confidential and proprietary.
 *
 * @emails oncall+recoil
 * @flow strict-local
 * @format
 */
'use strict';

import type {Loadable} from 'Recoil';
import type {ItemKey, ItemSnapshot, ListenInterface} from '../RecoilSync';

const {act} = require('ReactTestUtils');
const {
  RecoilLoadable,
  atom,
  atomFamily,
  selectorFamily,
  useRecoilValue,
} = require('Recoil');

const {
  ReadsAtom,
  componentThatReadsAndWritesAtom,
  flushPromisesAndTimers,
  renderElements,
} = require('../../../packages/recoil/__test_utils__/Recoil_TestingUtils');
const {syncEffect, useRecoilSync} = require('../RecoilSync');
const React = require('react');
const {asType, match, number, string} = require('refine');

////////////////////////////
// Mock Storage
////////////////////////////
function TestRecoilSync({
  storeKey,
  storage,
  regListen,
}: {
  storeKey?: string,
  storage: Map<string, Loadable<mixed>>,
  regListen?: ListenInterface => void,
}) {
  useRecoilSync({
    storeKey,
    read: itemKey => {
      if (itemKey === 'error') {
        throw new Error('READ ERROR');
      }
      return storage.get(itemKey);
    },
    write: ({diff, allItems}) => {
      for (const [key, loadable] of diff.entries()) {
        loadable != null ? storage.set(key, loadable) : storage.delete(key);
      }
      for (const [itemKey, loadable] of diff) {
        expect(allItems.get(itemKey)?.contents).toEqual(loadable?.contents);
      }
    },
    listen: listenInterface => {
      regListen?.(listenInterface);
    },
  });
  return null;
}

///////////////////////
// Tests
///////////////////////
test('Write to storage', async () => {
  const atomA = atom({
    key: 'recoil-sync write A',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync write B',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });
  const ignoreAtom = atom({
    key: 'recoil-sync write ignore',
    default: 'DEFAULT',
  });

  const storage = new Map();

  const [AtomA, setA, resetA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB] = componentThatReadsAndWritesAtom(atomB);
  const [IgnoreAtom, setIgnore] = componentThatReadsAndWritesAtom(ignoreAtom);
  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <AtomA />
      <AtomB />
      <IgnoreAtom />
    </>,
  );

  expect(storage.size).toBe(0);
  expect(container.textContent).toBe('"DEFAULT""DEFAULT""DEFAULT"');

  act(() => setA('A'));
  act(() => setB('B'));
  act(() => setIgnore('IGNORE'));
  expect(container.textContent).toBe('"A""B""IGNORE"');
  expect(storage.size).toBe(2);
  expect(storage.get('recoil-sync write A')?.getValue()).toBe('A');
  expect(storage.get('recoil-sync write B')?.getValue()).toBe('B');

  act(() => resetA());
  act(() => setB('BB'));
  expect(container.textContent).toBe('"DEFAULT""BB""IGNORE"');
  expect(storage.size).toBe(1);
  expect(storage.has('recoil-sync write A')).toBe(false);
  expect(storage.get('recoil-sync write B')?.getValue()).toBe('BB');
});

test('Write to multiple storages', async () => {
  const atomA = atom({
    key: 'recoil-sync multiple storage A',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({storeKey: 'A', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync multiple storage B',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({storeKey: 'B', refine: string()})],
  });

  const storageA = new Map();
  const storageB = new Map();

  const [AtomA, setA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB] = componentThatReadsAndWritesAtom(atomB);
  renderElements(
    <>
      <TestRecoilSync storeKey="A" storage={storageA} />
      <TestRecoilSync storeKey="B" storage={storageB} />
      <AtomA />
      <AtomB />
    </>,
  );

  expect(storageA.size).toBe(0);
  expect(storageB.size).toBe(0);

  act(() => setA('A'));
  act(() => setB('B'));
  expect(storageA.size).toBe(1);
  expect(storageB.size).toBe(1);
  expect(storageA.get('recoil-sync multiple storage A')?.getValue()).toBe('A');
  expect(storageB.get('recoil-sync multiple storage B')?.getValue()).toBe('B');
});

test('Read from storage', async () => {
  const atomA = atom({
    key: 'recoil-sync read A',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync read B',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync read C',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });

  const storage = new Map([
    ['recoil-sync read A', RecoilLoadable.of('A')],
    ['recoil-sync read B', RecoilLoadable.of('B')],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </>,
  );

  expect(container.textContent).toBe('"A""B""DEFAULT"');
});

test('Read from storage async', async () => {
  const atomA = atom({
    key: 'recoil-sync read async',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });

  const storage = new Map([
    ['recoil-sync read async', RecoilLoadable.of(Promise.resolve('A'))],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
    </>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"A"');
});

test('Read from storage error', async () => {
  const atomA = atom({
    key: 'recoil-sync read error A',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync read error B',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({refine: string(), actionOnFailure: 'defaultValue'}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync read error C',
    default: 'DEFAULT',
    // <TestRecoilSync> will throw error if the key is "error"
    effects_UNSTABLE: [syncEffect({itemKey: 'error', refine: string()})],
  });
  const atomD = atom({
    key: 'recoil-sync read error D',
    default: 'DEFAULT',
    // <TestRecoilSync> will throw error if the key is "error"
    effects_UNSTABLE: [
      syncEffect({
        itemKey: 'error',
        refine: string(),
        actionOnFailure: 'defaultValue',
      }),
    ],
  });
  const atomE = atom({
    key: 'recoil-sync read error E',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: string(),
      }),
    ],
  });
  const atomF = atom({
    key: 'recoil-sync read error F',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: string(),
        actionOnFailure: 'defaultValue',
      }),
    ],
  });

  const mySelector = selectorFamily({
    key: 'recoil-sync read error selector',
    get:
      ({myAtom}) =>
      ({get}) => {
        try {
          return get(myAtom);
        } catch (e) {
          return e.message;
        }
      },
  });

  const storage = new Map([
    ['recoil-sync read error A', RecoilLoadable.error(new Error('ERROR A'))],
    ['recoil-sync read error B', RecoilLoadable.error(new Error('ERROR B'))],
    ['recoil-sync read error E', RecoilLoadable.of(999)],
    ['recoil-sync read error F', RecoilLoadable.of(999)],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={mySelector({myAtom: atomA})} />
      <ReadsAtom atom={mySelector({myAtom: atomB})} />
      <ReadsAtom atom={mySelector({myAtom: atomC})} />
      <ReadsAtom atom={mySelector({myAtom: atomD})} />
      <ReadsAtom atom={mySelector({myAtom: atomE})} />
      <ReadsAtom atom={mySelector({myAtom: atomF})} />
    </>,
  );

  expect(container.textContent).toBe(
    '"ERROR A""DEFAULT""READ ERROR""DEFAULT""[<root>]: value is not a string""DEFAULT"',
  );
});

test('Read from storage upgrade', async () => {
  // Fail validation
  const atomA = atom<string>({
    key: 'recoil-sync fail validation',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      // No matching sync effect
      syncEffect({refine: string(), actionOnFailure: 'defaultValue'}),
    ],
  });

  // Upgrade from number
  const atomB = atom<string>({
    key: 'recoil-sync upgrade number',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      // This sync effect is ignored
      syncEffect({
        refine: asType(string(), () => 'IGNORE'),
        actionOnFailure: 'defaultValue',
      }),
      syncEffect({
        refine: asType(number(), num => `${num}`),
        actionOnFailure: 'defaultValue',
      }),
      // This sync effect is ignored
      syncEffect({
        refine: asType(string(), () => 'IGNORE'),
        actionOnFailure: 'defaultValue',
      }),
    ],
  });

  // Upgrade from string
  const atomC = atom<number>({
    key: 'recoil-sync upgrade string',
    default: 0,
    effects_UNSTABLE: [
      // This sync effect is ignored
      syncEffect({
        refine: asType(number(), () => 999),
        actionOnFailure: 'defaultValue',
      }),
      syncEffect({
        refine: asType(string(), Number),
        actionOnFailure: 'defaultValue',
      }),
      // This sync effect is ignored
      syncEffect({
        refine: asType(number(), () => 999),
        actionOnFailure: 'defaultValue',
      }),
    ],
  });

  // Upgrade from async
  const atomD = atom<string>({
    key: 'recoil-sync upgrade async',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: asType(number(), num => `${num}`),
        actionOnFailure: 'defaultValue',
      }),
    ],
  });

  const storage = new Map([
    ['recoil-sync fail validation', RecoilLoadable.of(123)],
    ['recoil-sync upgrade number', RecoilLoadable.of(123)],
    ['recoil-sync upgrade string', RecoilLoadable.of('123')],
    ['recoil-sync upgrade async', RecoilLoadable.of(Promise.resolve(123))],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
      <ReadsAtom atom={atomD} />
    </>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"DEFAULT""123"123"123"');
});

test('Read from storage upgrade - single effect', async () => {
  // Fail validation
  const atomA = atom<string>({
    key: 'recoil-sync fail validation - single',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      // No matching sync effect
      syncEffect({refine: string(), actionOnFailure: 'defaultValue'}),
    ],
  });

  // Upgrade from number
  const atomB = atom<string>({
    key: 'recoil-sync upgrade number - single',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: match(
          asType(string(), () => 'IGNORE'), // This rule is ignored
          asType(number(), num => `${num}`),
          asType(string(), () => 'IGNORE'), // This rule is ignored
        ),
      }),
    ],
  });

  // Upgrade from string
  const atomC = atom<number>({
    key: 'recoil-sync upgrade string - single',
    default: 0,
    effects_UNSTABLE: [
      syncEffect({
        refine: match(
          asType(number(), () => 999), // This rule is ignored
          asType(string(), Number),
          asType(number(), () => 999), // This rule is ignored
        ),
      }),
    ],
  });

  // Upgrade from async
  const atomD = atom<string>({
    key: 'recoil-sync upgrade async - single',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: match(
          string(),
          asType(number(), num => `${num}`),
        ),
      }),
    ],
  });

  const storage = new Map([
    ['recoil-sync fail validation - single', RecoilLoadable.of(123)],
    ['recoil-sync upgrade number - single', RecoilLoadable.of(123)],
    ['recoil-sync upgrade string - single', RecoilLoadable.of('123')],
    [
      'recoil-sync upgrade async - single',
      RecoilLoadable.of(Promise.resolve(123)),
    ],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
      <ReadsAtom atom={atomD} />
    </>,
  );

  expect(container.textContent).toBe('loading');
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"DEFAULT""123"123"123"');
});

test('Read/Write from storage upgrade', async () => {
  const atomA = atom<string>({
    key: 'recoil-sync read/write upgrade type',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({
        refine: match(
          string(),
          asType(number(), num => `${num}`),
        ),
      }),
    ],
  });
  const atomB = atom({
    key: 'recoil-sync read/write upgrade key',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({itemKey: 'OLD KEY', refine: string()}),
      syncEffect({itemKey: 'NEW KEY', refine: string()}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync read/write upgrade storage',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({refine: string()}),
      syncEffect({storeKey: 'OTHER_SYNC', refine: string()}),
    ],
  });

  const storage1 = new Map([
    ['recoil-sync read/write upgrade type', RecoilLoadable.of(123)],
    ['OLD KEY', RecoilLoadable.of('OLD')],
    ['recoil-sync read/write upgrade storage', RecoilLoadable.of('STR1')],
  ]);
  const storage2 = new Map([
    ['recoil-sync read/write upgrade storage', RecoilLoadable.of('STR2')],
  ]);

  const [AtomA, setA, resetA] = componentThatReadsAndWritesAtom(atomA);
  const [AtomB, setB, resetB] = componentThatReadsAndWritesAtom(atomB);
  const [AtomC, setC, resetC] = componentThatReadsAndWritesAtom(atomC);
  const container = renderElements(
    <>
      <TestRecoilSync storage={storage1} />
      <TestRecoilSync storage={storage2} storeKey="OTHER_SYNC" />
      <AtomA />
      <AtomB />
      <AtomC />
    </>,
  );

  expect(container.textContent).toBe('"123""OLD""STR2"');
  expect(storage1.size).toBe(3);

  act(() => setA('A'));
  act(() => setB('B'));
  act(() => setC('C'));
  expect(container.textContent).toBe('"A""B""C"');
  expect(storage1.size).toBe(4);
  expect(storage1.get('recoil-sync read/write upgrade type')?.getValue()).toBe(
    'A',
  );
  expect(storage1.get('OLD KEY')?.getValue()).toBe('B');
  expect(storage1.get('NEW KEY')?.getValue()).toBe('B');
  expect(
    storage1.get('recoil-sync read/write upgrade storage')?.getValue(),
  ).toBe('C');
  expect(storage2.size).toBe(1);
  expect(
    storage2.get('recoil-sync read/write upgrade storage')?.getValue(),
  ).toBe('C');

  act(() => resetA());
  act(() => resetB());
  act(() => resetC());
  expect(container.textContent).toBe('"DEFAULT""DEFAULT""DEFAULT"');
  expect(storage1.size).toBe(0);
  expect(storage2.size).toBe(0);
});

test('Listen to storage', async () => {
  const atomA = atom({
    key: 'recoil-sync listen',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({storeKey: 'SYNC_1', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync listen to multiple keys',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({storeKey: 'SYNC_1', itemKey: 'KEY A', refine: string()}),
      syncEffect({storeKey: 'SYNC_1', itemKey: 'KEY B', refine: string()}),
    ],
  });
  const atomC = atom({
    key: 'recoil-sync listen to multiple storage',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      syncEffect({storeKey: 'SYNC_1', refine: string()}),
      syncEffect({storeKey: 'SYNC_2', refine: string()}),
    ],
  });

  const storage1 = new Map([
    ['recoil-sync listen', RecoilLoadable.of('A')],
    ['KEY A', RecoilLoadable.of('B')],
    ['recoil-sync listen to multiple storage', RecoilLoadable.of('C1')],
  ]);
  const storage2 = new Map([
    ['recoil-sync listen to multiple storage', RecoilLoadable.of('C2')],
  ]);

  let updateItem1: (ItemKey, ?Loadable<mixed>) => void = () => {
    throw new Error('Failed to register 1');
  };
  let updateAll1: ItemSnapshot => void = _ => {
    throw new Error('Failed to register 1');
  };
  let updateItem2: (ItemKey, ?Loadable<mixed>) => void = () => {
    throw new Error('Failed to register 2');
  };
  const container = renderElements(
    <>
      <TestRecoilSync
        storeKey="SYNC_1"
        storage={storage1}
        regListen={listenInterface => {
          updateItem1 = listenInterface.updateItem;
          updateAll1 = listenInterface.updateAllKnownItems;
        }}
      />
      <TestRecoilSync
        storeKey="SYNC_2"
        storage={storage2}
        regListen={listenInterface => {
          updateItem2 = listenInterface.updateItem;
        }}
      />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </>,
  );

  expect(container.textContent).toBe('"A""B""C2"');
  expect(storage1.size).toBe(3);

  // Subscribe to new value
  act(() => updateItem1('recoil-sync listen', RecoilLoadable.of('AA')));
  expect(container.textContent).toBe('"AA""B""C2"');
  // Avoid feedback loops
  expect(storage1.get('recoil-sync listen')?.getValue()).toBe('A');

  // Subscribe to new value from different key
  act(() => updateItem1('KEY A', RecoilLoadable.of('BB')));
  expect(container.textContent).toBe('"AA""BB""C2"');
  // Neither key in same storage will be updated to avoid feedback loops
  expect(storage1.get('KEY A')?.getValue()).toBe('B');
  expect(storage1.get('KEY B')?.getValue()).toBe(undefined);
  act(() => updateItem1('KEY B', RecoilLoadable.of('BBB')));
  expect(container.textContent).toBe('"AA""BBB""C2"');
  expect(storage1.get('KEY A')?.getValue()).toBe('B');
  expect(storage1.get('KEY B')?.getValue()).toBe(undefined);

  // TODO
  // // Updating older key won't override newer key
  // act(() => updateItem1('KEY A', RecoilLoadable.of('IGNORE')));
  // expect(container.textContent).toBe('"AA""BBB""C2"');

  // Subscribe to new value from different storage
  act(() =>
    updateItem1(
      'recoil-sync listen to multiple storage',
      RecoilLoadable.of('CC1'),
    ),
  );
  expect(container.textContent).toBe('"AA""BBB""CC1"');
  // Avoid feedback loops, do not update storage based on listening to the storage
  expect(
    storage1.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('C1');
  // But, we should update other storages to stay in sync
  expect(
    storage2.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CC1');

  act(() =>
    updateItem2(
      'recoil-sync listen to multiple storage',
      RecoilLoadable.of('CC2'),
    ),
  );
  expect(container.textContent).toBe('"AA""BBB""CC2"');
  expect(
    storage1.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CC2');
  expect(
    storage2.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CC1');

  act(() =>
    updateItem1(
      'recoil-sync listen to multiple storage',
      RecoilLoadable.of('CCC1'),
    ),
  );
  expect(container.textContent).toBe('"AA""BBB""CCC1"');
  expect(
    storage1.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CC2');
  expect(
    storage2.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CCC1');

  // Subscribe to reset
  act(() => updateItem1('recoil-sync listen to multiple storage', null));
  expect(container.textContent).toBe('"AA""BBB""DEFAULT"');
  expect(
    storage1.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe('CC2');
  expect(
    storage2.get('recoil-sync listen to multiple storage')?.getValue(),
  ).toBe(undefined);

  // Subscribe to error
  const ERROR = new Error('ERROR');
  act(() => updateItem1('recoil-sync listen', RecoilLoadable.error(ERROR)));
  // TODO Atom should be put in an error state, but is just reset for now.
  expect(container.textContent).toBe('"DEFAULT""BBB""DEFAULT"');
  // expect(storage1.get('recoil-sync listen')?.errorOrThrow()).toBe(ERROR);

  // Update All Items
  // Set A while resetting B
  act(() =>
    updateAll1(new Map([['recoil-sync listen', RecoilLoadable.of('AAA')]])),
  );
  expect(container.textContent).toBe('"AAA""DEFAULT""DEFAULT"');

  // Update All Items
  // Setting older Key while newer Key is blank will take value instead of default
  act(() =>
    updateAll1(
      new Map([
        ['recoil-sync listen', RecoilLoadable.of('AAA')],
        ['KEY A', RecoilLoadable.of('BBB')],
      ]),
    ),
  );
  expect(container.textContent).toBe('"AAA""BBB""DEFAULT"');

  // Update All Items
  // Setting an older and newer key will take the newer key value
  act(() =>
    updateAll1(
      new Map([
        ['recoil-sync listen', RecoilLoadable.of('AAA')],
        ['KEY A', RecoilLoadable.of('IGNORE')],
        ['KEY B', RecoilLoadable.of('BBBB')],
      ]),
    ),
  );
  expect(container.textContent).toBe('"AAA""BBBB""DEFAULT"');

  // TODO Async Atom support
  // act(() =>
  //   updateItem1(
  //     'recoil-sync listen',
  //     RecoilLoadable.of(Promise.resolve( 'ASYNC')),
  //   ),
  // );
  // await flushPromisesAndTimers();
  // expect(container.textContent).toBe('"ASYNC""BBBB""DEFAULT"');

  // act(() =>
  //   updateItem1(
  //     'KEY B', RecoilLoadable.of(Promise.reject(new Error('ERROR B'))),
  //   ),
  // );
  // await flushPromisesAndTimers();
  // expect(container.textContent).toBe('error');
});

test('Persist on read', async () => {
  const atomA = atom({
    key: 'recoil-sync persist on read default',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({refine: string(), syncDefault: true})],
  });
  const atomB = atom({
    key: 'recoil-sync persist on read init',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      ({setSelf}) => setSelf('INIT_BEFORE'),
      syncEffect({refine: string(), syncDefault: true}),
      ({setSelf}) => setSelf('INIT_AFTER'),
    ],
  });

  const storage = new Map();

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
    </>,
  );

  expect(storage.size).toBe(0);
  expect(container.textContent).toBe('"DEFAULT""INIT_AFTER"');

  await flushPromisesAndTimers();

  expect(storage.size).toBe(2);
  expect(storage.get('recoil-sync persist on read default')?.getValue()).toBe(
    'DEFAULT',
  );
  expect(storage.get('recoil-sync persist on read init')?.getValue()).toBe(
    'INIT_AFTER',
  );
});

test('Persist on read - async', async () => {
  let resolveA, resolveB1, resolveB2;

  const atomA = atom({
    key: 'recoil-sync persist on read default async',
    default: new Promise(resolve => {
      resolveA = resolve;
    }),
    effects_UNSTABLE: [syncEffect({refine: string(), syncDefault: true})],
  });
  const atomB = atom({
    key: 'recoil-sync persist on read init async',
    default: 'DEFAULT',
    effects_UNSTABLE: [
      ({setSelf}) =>
        setSelf(
          new Promise(resolve => {
            resolveB1 = resolve;
          }),
        ),
      syncEffect({refine: string(), syncDefault: true}),
      ({setSelf}) =>
        setSelf(
          new Promise(resolve => {
            resolveB2 = resolve;
          }),
        ),
    ],
  });

  const storage = new Map();

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
    </>,
  );

  await flushPromisesAndTimers();
  expect(storage.size).toBe(0);

  act(() => {
    resolveA('ASYNC_DEFAULT');
  });
  await flushPromisesAndTimers();
  expect(storage.size).toBe(1);

  act(() => {
    resolveB1('ASYNC_INIT_BEFORE');
  });
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('loading');
  expect(storage.size).toBe(1);

  act(() => {
    resolveB2('ASYNC_INIT_AFTER');
  });
  await flushPromisesAndTimers();
  expect(container.textContent).toBe('"ASYNC_DEFAULT""ASYNC_INIT_AFTER"');
  expect(storage.size).toBe(2);
  expect(
    storage.get('recoil-sync persist on read default async')?.getValue(),
  ).toBe('ASYNC_DEFAULT');
  expect(
    storage.get('recoil-sync persist on read init async')?.getValue(),
  ).toBe('ASYNC_INIT_AFTER');
});

test('Sync based on component props', async () => {
  function SyncWithProps(props) {
    useRecoilSync({
      read: itemKey =>
        itemKey in props ? RecoilLoadable.of(props[itemKey]) : null,
    });
    return null;
  }

  const atomA = atom({
    key: 'recoil-sync from props spam',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({itemKey: 'spam', refine: string()})],
  });
  const atomB = atom({
    key: 'recoil-sync from props eggs',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({itemKey: 'eggs', refine: string()})],
  });
  const atomC = atom({
    key: 'recoil-sync from props default',
    default: 'DEFAULT',
    effects_UNSTABLE: [syncEffect({itemKey: 'default', refine: string()})],
  });

  const container = renderElements(
    <>
      <SyncWithProps spam="SPAM" eggs="EGGS" />
      <ReadsAtom atom={atomA} />
      <ReadsAtom atom={atomB} />
      <ReadsAtom atom={atomC} />
    </>,
  );

  expect(container.textContent).toBe('"SPAM""EGGS""DEFAULT"');
});

test('Sync Atom Family', async () => {
  const atoms = atomFamily({
    key: 'recoil-sync atom family',
    default: 'DEFAULT',
    effects_UNSTABLE: param => [syncEffect({itemKey: param, refine: string()})],
  });

  const storage = new Map([
    ['a', RecoilLoadable.of('A')],
    ['b', RecoilLoadable.of('B')],
  ]);

  const container = renderElements(
    <>
      <TestRecoilSync storage={storage} />
      <ReadsAtom atom={atoms('a')} />
      <ReadsAtom atom={atoms('b')} />
      <ReadsAtom atom={atoms('c')} />
    </>,
  );

  expect(container.textContent).toBe('"A""B""DEFAULT"');
});

// Test that using atoms before the sync hook initialize properly
test('Reading before sync hook', async () => {
  const atoms = atomFamily({
    key: 'recoil-sync order',
    default: 'DEFAULT',
    effects_UNSTABLE: param => [syncEffect({itemKey: param, refine: string()})],
  });

  function SyncOrder() {
    const b = useRecoilValue(atoms('b'));
    useRecoilSync({
      read: itemKey => RecoilLoadable.of(itemKey.toUpperCase()),
    });
    const c = useRecoilValue(atoms('c'));
    return (
      <div>
        {String(b)}
        {String(c)}
        <ReadsAtom atom={atoms('d')} />
      </div>
    );
  }

  function MyRoot() {
    return (
      <div>
        <ReadsAtom atom={atoms('a')} />
        <SyncOrder />
        <ReadsAtom atom={atoms('e')} />
      </div>
    );
  }

  const container = renderElements(<MyRoot />);

  expect(container.textContent).toBe('"A"BC"D""E"');
});
