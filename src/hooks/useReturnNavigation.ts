import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { goReturn, humanizeReturnLabel, type LocationStateWithFrom } from "../lib/returnNavigation";

export function useReturnNavigation(
  fallbackTo: string,
  opts?: { practiceBankId?: string },
) {
  const navigate = useNavigate();
  const location = useLocation();

  const fromPath = useMemo(() => {
    const st = location.state as LocationStateWithFrom | null | undefined;
    return typeof st?.from === "string" ? st.from : undefined;
  }, [location.state]);

  const handleReturn = useCallback(() => {
    goReturn(navigate, location, fallbackTo);
  }, [navigate, location, fallbackTo]);

  const returnLabel = useMemo(
    () => humanizeReturnLabel(fromPath, { practiceBankId: opts?.practiceBankId }),
    [fromPath, opts?.practiceBankId],
  );

  return { handleReturn, returnLabel, fromPath };
}
