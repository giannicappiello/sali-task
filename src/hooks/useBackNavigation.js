import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

export default function useBackNavigation(fallbackPath = "/home") {
  const navigate = useNavigate();

  return useCallback(() => {
    const historyIndex = Number(window.history.state?.idx);
    if (Number.isFinite(historyIndex) && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate(fallbackPath, { replace: true });
  }, [fallbackPath, navigate]);
}
