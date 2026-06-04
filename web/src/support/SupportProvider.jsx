import { createContext, useContext, useState, useCallback } from 'react';
import SupportWidget from './SupportWidget.jsx';

const SupportCtx = createContext(null);
export const useSupport = () => useContext(SupportCtx);

export function SupportProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');       // 'chat' | 'help' | 'ticket'
  const [draft, setDraft] = useState(null);     // optional prefilled ticket

  const openSupport = useCallback((opts = {}) => {
    if (opts.tab) setTab(opts.tab);
    if (opts.draft) setDraft(opts.draft);
    setOpen(true);
  }, []);
  const openTicket = useCallback((draft) => openSupport({ tab: 'ticket', draft }), [openSupport]);
  const close = useCallback(() => setOpen(false), []);

  return (
    <SupportCtx.Provider value={{ open, openSupport, openTicket, close }}>
      {children}
      <SupportWidget
        open={open}
        setOpen={setOpen}
        tab={tab}
        setTab={setTab}
        draft={draft}
        clearDraft={() => setDraft(null)}
      />
    </SupportCtx.Provider>
  );
}
