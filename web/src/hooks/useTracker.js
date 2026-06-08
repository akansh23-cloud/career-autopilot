import { useEffect, useState, useCallback } from 'react';
import {
  getTrackerBoard, funnelFromBoard, boardTotal, TRACKER_EVENT,
  saveJobToTracker, addManualApplication, moveTrackerCard, removeTrackerCard,
} from '../lib/trackerStore.js';

// Live view of the shared tracker board. Every consumer (Jobs, Tracker,
// Dashboard funnel, Growth) uses this so a change in one place reflects
// everywhere instantly and survives refresh via the store's persistence.
export function useTracker() {
  const [board, setBoard] = useState(getTrackerBoard);

  useEffect(() => {
    const sync = () => setBoard(getTrackerBoard());
    window.addEventListener(TRACKER_EVENT, sync);
    window.addEventListener('storage', sync); // cross-tab
    return () => {
      window.removeEventListener(TRACKER_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const saveJob = useCallback((job) => saveJobToTracker(job), []);
  const addManual = useCallback((draft) => addManualApplication(draft), []);
  const move = useCallback((colId, id, dir) => moveTrackerCard(colId, id, dir), []);
  const remove = useCallback((colId, id) => removeTrackerCard(colId, id), []);

  return {
    board,
    funnel: funnelFromBoard(board),
    total: boardTotal(board),
    saveJob,
    addManual,
    move,
    remove,
  };
}

export default useTracker;
