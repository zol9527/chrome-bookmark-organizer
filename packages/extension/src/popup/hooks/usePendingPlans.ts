import { useEffect, useState } from 'react';
import type { Plan } from '@cborg/shared';
import { rpc, subscribeInternalEvent } from '../../shared/rpc-client';

const pendingOnly = (plans: Plan[]) => plans.filter((plan) => plan.status === 'pending');

export function usePendingPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void rpc
      .call({ type: 'plan:list' })
      .then(({ plans: next }) => active && setPlans(pendingOnly(next).sort((a, b) => b.createdAt - a.createdAt)))
      .catch(() => active && setPlans([]))
      .finally(() => active && setLoading(false));

    return subscribeInternalEvent((event) => {
      if (event.type === 'plan:created' && event.plan.status === 'pending') {
        setPlans((current) => [event.plan, ...current.filter((plan) => plan.id !== event.plan.id)]);
      }
      if (event.type === 'plan:updated') {
        setPlans((current) =>
          event.plan.status === 'pending'
            ? [event.plan, ...current.filter((plan) => plan.id !== event.plan.id)]
            : current.filter((plan) => plan.id !== event.plan.id),
        );
      }
    });
  }, []);

  return { plans, loading, setPlans };
}
