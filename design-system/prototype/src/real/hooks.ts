import { useEffect, useState } from 'react';
import { onDataChanged } from '@/lib/data-events';
import type { Fact } from '@/lib/evidence-base';
import { listFacts } from '@/lib/evidence-store';
import { listMyDocuments, type MyDocument } from '@/lib/me-store';

// База доказательств компании: факты с источниками и сроками. Перечитывается, когда её меняют.
export function useFacts(): { facts: Fact[]; ready: boolean; failed: boolean } {
  const [state, setState] = useState<{ facts: Fact[]; ready: boolean; failed: boolean }>({ facts: [], ready: false, failed: false });
  useEffect(() => {
    let alive = true;
    const load = () =>
      listFacts().then(
        (facts) => alive && setState({ facts, ready: true, failed: false }),
        () => alive && setState({ facts: [], ready: true, failed: true }),
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
