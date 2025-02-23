/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+recoil
 * @flow strict-local
 * @format
 */
'use strict';

import type {PersistenceType} from '../core/Recoil_Node';
import type {NodeKey, Store, TreeState} from '../core/Recoil_State';

const {batchUpdates} = require('../core/Recoil_Batching');
const {DEFAULT_VALUE, getNode, nodes} = require('../core/Recoil_Node');
const {useStoreRef} = require('../core/Recoil_RecoilRoot.react');
const {
  AbstractRecoilValue,
  setRecoilValueLoadable,
} = require('../core/Recoil_RecoilValueInterface');
const {SUSPENSE_TIMEOUT_MS} = require('../core/Recoil_Retention');
const {Snapshot, cloneSnapshot} = require('../core/Recoil_Snapshot');
const {isSSR} = require('../util/Recoil_Environment');
const filterMap = require('../util/Recoil_filterMap');
const filterSet = require('../util/Recoil_filterSet');
const mapMap = require('../util/Recoil_mapMap');
const mergeMaps = require('../util/Recoil_mergeMaps');
const nullthrows = require('../util/Recoil_nullthrows');
const recoverableViolation = require('../util/Recoil_recoverableViolation');
const usePrevious = require('../util/Recoil_usePrevious');
const {useCallback, useEffect, useRef, useState} = require('react');

function useTransactionSubscription(callback: Store => void) {
  const storeRef = useStoreRef();
  useEffect(() => {
    const sub = storeRef.current.subscribeToTransactions(callback);
    return sub.release;
  }, [callback, storeRef]);
}

function externallyVisibleAtomValuesInState(
  state: TreeState,
): Map<NodeKey, mixed> {
  const atomValues = state.atomValues.toMap();
  const persistedAtomContentsValues = mapMap(
    filterMap(atomValues, (v, k) => {
      const node = getNode(k);
      const persistence = node.persistence_UNSTABLE;
      return (
        persistence != null &&
        persistence.type !== 'none' &&
        v.state === 'hasValue'
      );
    }),
    v => v.contents,
  );
  // Merge in nonvalidated atoms; we may not have defs for them but they will
  // all have persistence on or they wouldn't be there in the first place.
  return mergeMaps(
    state.nonvalidatedAtoms.toMap(),
    persistedAtomContentsValues,
  );
}

type ExternallyVisibleAtomInfo = {
  persistence_UNSTABLE: {
    type: PersistenceType,
    backButton: boolean,
    ...
  },
  ...
};

/**
  Calls the given callback after any atoms have been modified and the consequent
  component re-renders have been committed. This is intended for persisting
  the values of the atoms to storage. The stored values can then be restored
  using the useSetUnvalidatedAtomValues hook.

  The callback receives the following info:

  atomValues: The current value of every atom that is both persistable (persistence
              type not set to 'none') and whose value is available (not in an
              error or loading state).

  previousAtomValues: The value of every persistable and available atom before
               the transaction began.

  atomInfo: A map containing the persistence settings for each atom. Every key
            that exists in atomValues will also exist in atomInfo.

  modifiedAtoms: The set of atoms that were written to during the transaction.

  transactionMetadata: Arbitrary information that was added via the
          useSetUnvalidatedAtomValues hook. Useful for ignoring the useSetUnvalidatedAtomValues
          transaction, to avoid loops.
*/
function useTransactionObservation_DEPRECATED(
  callback: ({
    atomValues: Map<NodeKey, mixed>,
    previousAtomValues: Map<NodeKey, mixed>,
    atomInfo: Map<NodeKey, ExternallyVisibleAtomInfo>,
    modifiedAtoms: $ReadOnlySet<NodeKey>,
    transactionMetadata: {[NodeKey]: mixed, ...},
  }) => void,
) {
  useTransactionSubscription(
    useCallback(
      store => {
        let previousTree = store.getState().previousTree;
        const currentTree = store.getState().currentTree;
        if (!previousTree) {
          recoverableViolation(
            'Transaction subscribers notified without a previous tree being present -- this is a bug in Recoil',
            'recoil',
          );
          previousTree = store.getState().currentTree; // attempt to trundle on
        }

        const atomValues = externallyVisibleAtomValuesInState(currentTree);
        const previousAtomValues =
          externallyVisibleAtomValuesInState(previousTree);
        const atomInfo = mapMap(nodes, node => ({
          persistence_UNSTABLE: {
            type: node.persistence_UNSTABLE?.type ?? 'none',
            backButton: node.persistence_UNSTABLE?.backButton ?? false,
          },
        }));
        // Filter on existance in atomValues so that externally-visible rules
        // are also applied to modified atoms (specifically exclude selectors):
        const modifiedAtoms = filterSet(
          currentTree.dirtyAtoms,
          k => atomValues.has(k) || previousAtomValues.has(k),
        );

        callback({
          atomValues,
          previousAtomValues,
          atomInfo,
          modifiedAtoms,
          transactionMetadata: {...currentTree.transactionMetadata},
        });
      },
      [callback],
    ),
  );
}

function useRecoilTransactionObserver(
  callback: ({
    snapshot: Snapshot,
    previousSnapshot: Snapshot,
  }) => void,
) {
  useTransactionSubscription(
    useCallback(
      store => {
        const snapshot = cloneSnapshot(store, 'current');
        const previousSnapshot = cloneSnapshot(store, 'previous');
        callback({
          snapshot,
          previousSnapshot,
        });
      },
      [callback],
    ),
  );
}

// Return a snapshot of the current state and subscribe to all state changes
function useRecoilSnapshot(): Snapshot {
  const storeRef = useStoreRef();
  const [snapshot, setSnapshot] = useState(() =>
    cloneSnapshot(storeRef.current),
  );
  const previousSnapshot = usePrevious(snapshot);
  const timeoutID = useRef();

  useEffect(() => {
    if (timeoutID.current && !isSSR) {
      window.clearTimeout(timeoutID.current);
    }
    return snapshot.retain();
  }, [snapshot]);

  useTransactionSubscription(
    useCallback(store => setSnapshot(cloneSnapshot(store)), []),
  );

  if (previousSnapshot !== snapshot && !isSSR) {
    if (timeoutID.current) {
      previousSnapshot?.release_INTERNAL();
      window.clearTimeout(timeoutID.current);
    }
    snapshot.retain();
    timeoutID.current = window.setTimeout(() => {
      snapshot.release_INTERNAL();
      timeoutID.current = null;
    }, SUSPENSE_TIMEOUT_MS);
  }

  return snapshot;
}

function useGotoRecoilSnapshot(): Snapshot => void {
  const storeRef = useStoreRef();
  return useCallback(
    (snapshot: Snapshot) => {
      const storeState = storeRef.current.getState();
      const prev = storeState.nextTree ?? storeState.currentTree;
      const next = snapshot.getStore_INTERNAL().getState().currentTree;
      batchUpdates(() => {
        const keysToUpdate = new Set();
        for (const keys of [prev.atomValues.keys(), next.atomValues.keys()]) {
          for (const key of keys) {
            if (
              prev.atomValues.get(key)?.contents !==
                next.atomValues.get(key)?.contents &&
              getNode(key).shouldRestoreFromSnapshots
            ) {
              keysToUpdate.add(key);
            }
          }
        }
        keysToUpdate.forEach(key => {
          setRecoilValueLoadable(
            storeRef.current,
            new AbstractRecoilValue(key),
            next.atomValues.has(key)
              ? nullthrows(next.atomValues.get(key))
              : DEFAULT_VALUE,
          );
        });
        storeRef.current.replaceState(state => {
          return {
            ...state,
            stateID: snapshot.getID_INTERNAL(),
          };
        });
      });
    },
    [storeRef],
  );
}

module.exports = {
  useRecoilSnapshot,
  useGotoRecoilSnapshot,
  useRecoilTransactionObserver,
  useTransactionObservation_DEPRECATED,
  useTransactionSubscription_DEPRECATED: useTransactionSubscription,
};
