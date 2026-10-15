import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { showSnackbar } from '@openmrs/esm-framework';
import { type Order } from '../../types';
import { setFulfillerStatus, useInvalidateLabOrders } from '../../laboratory.resource';
import PickAllLabRequests from './pick-all-lab-requests.component';

vi.mock('../../laboratory.resource', () => ({
  setFulfillerStatus: vi.fn(),
  useInvalidateLabOrders: vi.fn(),
}));

const mockSetFulfillerStatus = vi.mocked(setFulfillerStatus);
const mockUseInvalidateLabOrders = vi.mocked(useInvalidateLabOrders);
const mockShowSnackbar = vi.mocked(showSnackbar);

const buildOrder = (uuid: string, fulfillerStatus?: string): Order =>
  ({ uuid, display: `Test ${uuid}`, orderNumber: `ORD-${uuid}`, fulfillerStatus } as unknown as Order);

describe('PickAllLabRequests', () => {
  const mockInvalidateLabOrders = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseInvalidateLabOrders.mockReturnValue(mockInvalidateLabOrders);
  });

  it('is hidden when fewer than two orders can be picked', () => {
    render(<PickAllLabRequests orders={[buildOrder('a'), buildOrder('b', 'IN_PROGRESS')]} />);

    expect(screen.queryByRole('button', { name: /pick all lab requests/i })).not.toBeInTheDocument();
  });

  it('picks only the orders that have not been picked yet', async () => {
    const user = userEvent.setup();
    mockSetFulfillerStatus.mockResolvedValue({} as never);

    render(
      <PickAllLabRequests
        orders={[
          buildOrder('a'),
          buildOrder('b', 'RECEIVED'),
          buildOrder('c', 'COMPLETED'),
          buildOrder('d', 'DECLINED'),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /pick all lab requests/i }));
    await user.click(screen.getByRole('button', { name: /^pick \{\{count\}\} lab requests$/i }));

    await waitFor(() => expect(mockSetFulfillerStatus).toHaveBeenCalledTimes(2));
    expect(mockSetFulfillerStatus).toHaveBeenCalledWith('a', 'IN_PROGRESS', expect.anything());
    expect(mockSetFulfillerStatus).toHaveBeenCalledWith('b', 'IN_PROGRESS', expect.anything());
    expect(mockInvalidateLabOrders).toHaveBeenCalled();
    expect(mockShowSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('reports the orders that failed to be picked', async () => {
    const user = userEvent.setup();
    mockSetFulfillerStatus.mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('boom'));

    render(<PickAllLabRequests orders={[buildOrder('a'), buildOrder('b')]} />);

    await user.click(screen.getByRole('button', { name: /pick all lab requests/i }));
    await user.click(screen.getByRole('button', { name: /^pick \{\{count\}\} lab requests$/i }));

    await waitFor(() =>
      expect(mockShowSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', subtitle: 'Test b' })),
    );
    expect(mockShowSnackbar).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });
});
