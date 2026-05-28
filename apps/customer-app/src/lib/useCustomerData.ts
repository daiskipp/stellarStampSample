// React hook: load the connected Smart Account's on-chain data.
//
// Centralises the loading / error / empty handling the pages share, so each
// page just renders against `data` (null until the first chain read resolves).

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { getCustomerData, type CustomerData } from "./chain";

export interface CustomerDataState {
  data: CustomerData | null;
  loading: boolean;
  error: string | null;
}

export function useCustomerData(): CustomerDataState {
  const { contractId } = useAuth();
  const [state, setState] = useState<CustomerDataState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!contractId) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    getCustomerData(contractId)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled)
          setState({
            data: null,
            loading: false,
            error:
              e instanceof Error ? e.message : "チェーンの読み取りに失敗しました",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  return state;
}
