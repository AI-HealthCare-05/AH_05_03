import { createContext, useContext, type ReactNode } from "react";

interface TabsContextValue {
  value: string;
  onValueChange: (val: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  value: string;
  onValueChange: (val: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className = "" }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={`sp-tabs-root ${className}`.trim()}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`sp-tabs-nav ${className}`.trim()}>{children}</div>;
}

export function TabsTrigger({
  value,
  children,
  className = "",
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");

  const isActive = context.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={`sp-tab-btn ${isActive ? "active" : ""} ${className}`.trim()}
      onClick={() => context.onValueChange(value)}
    >
      {children}
    </button>
  );
}
