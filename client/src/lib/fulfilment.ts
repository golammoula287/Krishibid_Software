import type {
  ClaimDto,
  ClaimStatus,
  CreateClaimInput,
  DeliveryStatus,
  ResolveClaimInput,
  SalesReportDto,
} from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { useToast } from './toast.js';

/** Advancing a consignment one step. Admin only; the API enforces that and the order. */
export function useAdvanceDelivery() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ orderId, status, note }: { orderId: string; status: DeliveryStatus; note?: string }) =>
      api.post(`/admin/delivery/${orderId}/status`, { status, note }),
    onSuccess: async () => {
      toast.showSuccess('delivery_advanced');
      // The order, the board and the overview all change on a step — the last one because
      // `delivered` moves money.
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      await queryClient.invalidateQueries({ queryKey: ['order'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export function useMyClaims() {
  return useQuery({ queryKey: ['claims', 'mine'], queryFn: () => api.get<ClaimDto[]>('/orders/claims/mine') });
}

export function useAdminClaims(status?: ClaimStatus) {
  return useQuery({
    queryKey: ['admin', 'claims', status ?? 'open'],
    queryFn: () => api.get<ClaimDto[]>(`/admin/claims${status ? `?status=${status}` : ''}`),
  });
}

export function useFileClaim() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateClaimInput) => api.post<ClaimDto>('/orders/claims', input),
    onSuccess: async () => {
      toast.showSuccess('claim_filed');
      await queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
  });
}

export function useResolveClaim() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResolveClaimInput }) =>
      api.post<ClaimDto>(`/admin/claims/${id}/resolve`, input),
    onSuccess: async () => {
      toast.showSuccess('claim_resolved');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

/** A supplier's own figures. */
export function useSalesReport(enabled = true) {
  return useQuery({
    queryKey: ['sales', 'mine'],
    queryFn: () => api.get<SalesReportDto>('/orders/sales/mine'),
    enabled,
  });
}
