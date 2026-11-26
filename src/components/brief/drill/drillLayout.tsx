import React from 'react';

/** Scrollable body of the drill dialog. */
export const DrillBody: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">{children}</div>
);

/** Bottom action bar of the drill dialog. */
export const DrillFooter: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-t border-[#23303E] bg-[#0B1117]">
    {children}
  </div>
);
