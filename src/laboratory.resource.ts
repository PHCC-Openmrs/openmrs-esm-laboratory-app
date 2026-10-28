import { useCallback } from 'react';
import dayjs from 'dayjs';
import useSWR, { mutate } from 'swr';
import { fhirBaseUrl, openmrsFetch, type Order, restBaseUrl, useAppContext, useConfig } from '@openmrs/esm-framework';
import type { DateFilterContext, FulfillerStatus } from './types';
import { type Config } from './config-schema';

const useLabOrdersDefaultParams: UseLabOrdersParams = {
  status: null,
  newOrdersOnly: false,
  excludeCanceled: true,
  includePatientId: false,
};

// The REST API returns only its default page (50 results) unless told otherwise, so the orders are
// requested page by page until the server reports no further page. Counts and tables then reflect
// every order instead of silently stopping at 50.
const LAB_ORDERS_PAGE_SIZE = 100;
// Safety net so a misbehaving server that always reports a next page cannot loop forever.
const LAB_ORDERS_MAX_PAGES = 100;

async function fetchAllLabOrders(url: string): Promise<{ data: { results: Array<Order> } }> {
  const results: Array<Order> = [];
  for (let page = 0; page < LAB_ORDERS_MAX_PAGES; page++) {
    const response = await openmrsFetch<{ results: Array<Order>; links?: Array<{ rel: string }> }>(
      `${url}&limit=${LAB_ORDERS_PAGE_SIZE}&startIndex=${results.length}`,
    );
    const pageResults = response.data?.results ?? [];
    results.push(...pageResults);
    const hasNextPage = response.data?.links?.some((link) => link.rel === 'next');
    if (!hasNextPage || pageResults.length === 0) {
      break;
    }
  }
  return { data: { results } };
}

interface UseLabOrdersParams {
  status: FulfillerStatus;
  newOrdersOnly: boolean;
  excludeCanceled: boolean;
  includePatientId: boolean;
}

/**
 * Custom hook for retrieving laboratory orders.
 *
 * @param status - The fulfiller status to filter by (e.g. 'IN_PROGRESS', 'COMPLETED')
 * @param newOrdersOnly - Whether to return only new orders that haven't been picked (action=NEW, fulfillerStatus=null). Filtered client-side as the REST API doesn't support this query natively.
 * @param excludeCanceled - Whether to exclude canceled, discontinued and expired orders
 * @param includePatientId - Whether to include patient identifiers in the response
 */
export function useLabOrders(params: Partial<UseLabOrdersParams> = useLabOrdersDefaultParams) {
  const definedParams = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
  const { status, newOrdersOnly, excludeCanceled, includePatientId } = {
    ...useLabOrdersDefaultParams,
    ...definedParams,
  };
  const { dateRange } = useAppContext<DateFilterContext>('laboratory-date-filter') ?? {
    dateRange: [dayjs().startOf('day').toDate(), new Date()],
  };

  const { laboratoryOrderTypeUuid } = useConfig();
  const customRepresentation = `custom:(uuid,orderNumber,patient:(uuid,display,person:(uuid,display,age,birthdate,gender)${
    includePatientId ? ',identifiers' : ''
  }),concept:(uuid,display),action,careSetting:(uuid,display,description,careSettingType,display),previousOrder,dateActivated,scheduledDate,dateStopped,autoExpireDate,encounter:(uuid,display),orderer:(uuid,display),orderReason,orderReasonNonCoded,orderType:(uuid,display,name,description,conceptClasses,parent),urgency,instructions,commentToFulfiller,display,fulfillerStatus,fulfillerComment,accessionNumber,specimenSource,laterality,clinicalHistory,frequency,numberOfRepeats)`;
  let url = `${restBaseUrl}/order?orderTypes=${laboratoryOrderTypeUuid}&v=${customRepresentation}`;
  url = status ? url + `&fulfillerStatus=${status}` : url;
  url = excludeCanceled ? `${url}&excludeCanceledAndExpired=true&excludeDiscontinueOrders=true` : url;
  // The date picker yields each picked date as midnight at the start of that day, so cover the whole
  // first and last day; otherwise orders placed on the end date are left out (and a single-day range
  // would be empty).
  url = dateRange
    ? `${url}&activatedOnOrAfterDate=${dayjs(dateRange.at(0))
        .startOf('day')
        .toISOString()}&activatedOnOrBeforeDate=${dayjs(dateRange.at(1)).endOf('day').toISOString()}`
    : url;

  const { data, error, mutate, isLoading, isValidating } = useSWR<{
    data: { results: Array<Order> };
  }>(`${url}`, fetchAllLabOrders);

  const filteredOrders = data?.data?.results?.filter(
    (order) => !newOrdersOnly || (order?.action === 'NEW' && order?.fulfillerStatus === null),
  );
  return {
    labOrders: filteredOrders ?? [],
    isLoading,
    isError: error,
    mutate,
    isValidating,
  };
}

interface FhirCondition {
  clinicalStatus?: { coding?: Array<{ code?: string }> };
  code?: { coding?: Array<{ display?: string }>; text?: string };
}

/**
 * Retrieves the active conditions of the given patients -- what the patient chart's "Diagnoses"
 * page records -- so the laboratory team can see them next to the orders.
 *
 * @returns the names of each patient's active conditions, keyed by patient uuid
 */
export function useActiveConditions(patientUuids: Array<string>) {
  const { data } = useSWR(
    patientUuids.length ? ['lab-active-conditions', ...patientUuids] : null,
    ([, ...uuids]: Array<string>) =>
      Promise.all(
        uuids.map((uuid) =>
          openmrsFetch<{ entry?: Array<{ resource: FhirCondition }> }>(
            `${fhirBaseUrl}/Condition?patient=${uuid}&_count=100`,
          )
            .then((response) => [
              ...new Set(
                (response.data?.entry ?? [])
                  .map((entry) => entry.resource)
                  .filter((condition) => condition.clinicalStatus?.coding?.[0]?.code?.toLowerCase() === 'active')
                  .map((condition) => condition.code?.coding?.[0]?.display ?? condition.code?.text)
                  .filter(Boolean),
              ),
            ])
            // one patient whose conditions cannot be read must not hide the others
            .catch(() => [] as Array<string>),
        ),
      ),
  );

  const conditionsByPatient: Record<string, Array<string>> = {};
  patientUuids.forEach((uuid, index) => {
    conditionsByPatient[uuid] = data?.[index] ?? [];
  });
  return conditionsByPatient;
}

export function setFulfillerStatus(orderId: string, status: FulfillerStatus, abortController: AbortController) {
  return openmrsFetch(`${restBaseUrl}/order/${orderId}/fulfillerdetails/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: abortController.signal,
    body: { fulfillerStatus: status },
  });
}

export function rejectLabOrder(orderId: string, comment: string, abortController: AbortController) {
  return openmrsFetch(`${restBaseUrl}/order/${orderId}/fulfillerdetails/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: abortController.signal,
    body: {
      fulfillerStatus: 'DECLINED',
      fulfillerComment: comment,
    },
  });
}

/**
 * Custom hook that returns a function to invalidate and refetch all lab orders.
 * Use this after mutations to ensure the UI reflects the latest data.
 */
export function useInvalidateLabOrders() {
  const { laboratoryOrderTypeUuid } = useConfig<Config>();

  return useCallback(() => {
    mutate(
      (key) => typeof key === 'string' && key.startsWith(`${restBaseUrl}/order?orderTypes=${laboratoryOrderTypeUuid}`),
      undefined,
      { revalidate: true },
    );
  }, [laboratoryOrderTypeUuid]);
}
