import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '@carbon/react';
import { showSnackbar, useAbortController } from '@openmrs/esm-framework';
import { type Order } from '../../types';
import { setFulfillerStatus, useInvalidateLabOrders } from '../../laboratory.resource';
import styles from './pick-all-lab-requests.scss';

interface PickAllLabRequestsProps {
  orders: Array<Order>;
}

/** An order can be picked while it has not been picked, declined or progressed yet. */
export const isPickable = (order: Order) => order.fulfillerStatus === 'RECEIVED' || order.fulfillerStatus == null;

const PickAllLabRequests: React.FC<PickAllLabRequestsProps> = ({ orders }) => {
  const { t } = useTranslation();
  const abortController = useAbortController();
  const invalidateLabOrders = useInvalidateLabOrders();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pickableOrders = orders.filter(isPickable);

  // With a single pickable order the per-order "Pick lab request" button already covers it.
  if (pickableOrders.length < 2) {
    return null;
  }

  const handlePickAll = async () => {
    setIsSubmitting(true);
    const results = await Promise.allSettled(
      pickableOrders.map((order) => setFulfillerStatus(order.uuid, 'IN_PROGRESS', abortController)),
    );

    const pickedCount = results.filter((result) => result.status === 'fulfilled').length;
    const failedOrders = pickableOrders.filter((_, index) => results[index].status === 'rejected');

    invalidateLabOrders();

    if (pickedCount > 0) {
      showSnackbar({
        isLowContrast: true,
        kind: 'success',
        title: t('pickedOrders', '{{count}} lab requests picked', { count: pickedCount }),
        subtitle: t('ordersPickedSuccessfully', 'You have successfully picked the lab requests'),
      });
    }
    if (failedOrders.length > 0) {
      showSnackbar({
        kind: 'error',
        title: t('pickAllPartialError', 'Some lab requests could not be picked'),
        subtitle: failedOrders.map((order) => order.display).join(', '),
      });
    }

    setIsSubmitting(false);
    setIsConfirmOpen(false);
  };

  return (
    <div className={styles.pickAllContainer}>
      <Button kind="primary" size="sm" disabled={isSubmitting} onClick={() => setIsConfirmOpen(true)}>
        {t('pickAllRequests', 'Pick all lab requests')}
      </Button>
      <Modal
        open={isConfirmOpen}
        modalHeading={t('pickAllRequestsHeading', 'Pick all lab requests')}
        primaryButtonText={
          isSubmitting
            ? t('picking', 'Picking...')
            : t('pickAllConfirm', 'Pick {{count}} lab requests', { count: pickableOrders.length })
        }
        secondaryButtonText={t('cancel', 'Cancel')}
        primaryButtonDisabled={isSubmitting}
        onRequestClose={() => !isSubmitting && setIsConfirmOpen(false)}
        onRequestSubmit={() => void handlePickAll()}
      >
        <p>
          {t(
            'pickAllRequestsConfirmationText',
            'Continuing will update the status of these requests to "In Progress" and advance them to the next stage. Are you sure you want to proceed?',
          )}
        </p>
        <ul className={styles.orderList}>
          {pickableOrders.map((order) => (
            <li key={order.uuid}>
              <strong>{order.display}</strong> ({order.orderNumber})
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
};

export default PickAllLabRequests;
