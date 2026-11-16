"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface State<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Minimal fetch hook: reruns when `deps` change, keeps previous data while reloading
 * (no flicker between pages/filters), ignores stale responses.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  const load = useCallback(
    async (silent = false) => {
      const id = ++seq.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await run();
        if (id === seq.current) setState({ data, error: null, loading: false });
      } catch (e) {
        if (id === seq.current) setState((s) => ({ data: s.data, error: e as Error, loading: false }));
      }
    },
    [run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: () => load(true), setData: (data: T) => setState((s) => ({ ...s, data })) };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Multi-select helper for tables. */
export function useSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const allOnPage = ids.length > 0 && ids.every((id) => selected.has(id));
  const someOnPage = ids.some((id) => selected.has(id));
  const toggleAll = useCallback(() => {
    setSelected((s) => {
      const n = new Set(s);
      if (ids.length > 0 && ids.every((id) => n.has(id))) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }, [ids]);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, toggleAll, clear, allOnPage, someOnPage, count: selected.size };
}
