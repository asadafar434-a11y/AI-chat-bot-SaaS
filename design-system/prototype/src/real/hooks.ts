import { useEffect, useState } from 'react';
import { onDataChanged } from '@/lib/db';
import { listMyDocuments, type MyDocument } from '@/lib/me-store';

// «Образцы и реквизиты» участника: прошлые заявки и документы компании. Перечитываются, когда их меняют.
export function useMyDocs(): { docs: MyDocument[]; ready: boolean } {
  const [state, setState] = useState<{ docs: MyDocument[]; ready: boolean }>({ docs: [], ready: false });
  useEffect(() => {
    let alive = true;
    const load = () =>
      listMyDocuments().then(
        (docs) => alive && setState({ docs, ready: true }),
        () => alive && setState({ docs: [], ready: true }),
      );
    void load();
    const off = onDataChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
