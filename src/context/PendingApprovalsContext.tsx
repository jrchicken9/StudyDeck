import { createContext, useContext, type ReactNode } from "react";

const PendingApprovalsContext = createContext(0);

export function PendingApprovalsProvider({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <PendingApprovalsContext.Provider value={count}>
      {children}
    </PendingApprovalsContext.Provider>
  );
}

export function usePendingApprovalsFromLayout(): number {
  return useContext(PendingApprovalsContext);
}
