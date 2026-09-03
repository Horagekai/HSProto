import { useSyncExternalStore } from 'react';
import { store } from '../core/store';

export function useHud() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
