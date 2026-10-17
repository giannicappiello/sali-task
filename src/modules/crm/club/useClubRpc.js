import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { clubError } from './clubModel';

export default function useClubRpc(name, parameters = {}) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const generation = useRef(0);
  const parametersKey = JSON.stringify(parameters);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState(current => ({ ...current, error: '', loading: true }));
    try {
      const { data, error } = await supabase.rpc(name, JSON.parse(parametersKey));
      if (error) throw error;
      if (generation.current === request) setState({ data, error: '', loading: false });
    } catch (error) {
      if (generation.current === request) setState({ data: null, error: clubError(error), loading: false });
    }
  }, [name, parametersKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const sequence = generation;
    return () => { window.clearTimeout(timer); sequence.current++; };
  }, [load]);
  return { ...state, reload: load };
}
