import { useCallback, useEffect, useState } from "react";
import { requestJson } from "./api-client.js";

export interface ApiData {
  data: unknown;
  error: unknown;
  isLoading: boolean;
  reload: () => void;
}

interface LoadState {
  path: string;
  version: number;
  data: unknown;
  error: unknown;
}

export const useApiData = (path: string | undefined): ApiData => {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<LoadState | undefined>(undefined);

  useEffect(() => {
    if (path === undefined) {
      return;
    }
    let isCurrent = true;
    requestJson(path).then(
      (data) => {
        if (isCurrent) {
          setState({ path, version, data, error: undefined });
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setState({ path, version, data: undefined, error });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [path, version]);

  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);

  const fresh =
    state !== undefined && state.path === path && state.version === version
      ? state
      : undefined;
  const isFresh = fresh !== undefined;
  return {
    data: fresh?.data,
    error: fresh?.error,
    isLoading: path !== undefined && !isFresh,
    reload,
  };
};
