import type {
  AdminOverviewDto,
  AssignDeliveryInput,
  ContactStatus,
  DeliveryQueueItemDto,
  ManagedUserDto,
  Role,
} from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from './api.js';
import { useToast } from './toast.js';

/** The dashboard, in one request — see the DTO for why it is not eight. */
export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api.get<AdminOverviewDto>('/admin/overview'),
    // Approvals and messages arrive while somebody is looking at this page.
    refetchInterval: 60_000,
  });
}

export function useDeliveryQueue(status: 'awaiting_dispatch' | 'dispatched') {
  return useQuery({
    queryKey: ['admin', 'delivery', status],
    queryFn: () => api.get<DeliveryQueueItemDto[]>(`/admin/delivery?status=${status}`),
  });
}

export function useAssignDelivery() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ orderId, input }: { orderId: string; input: AssignDeliveryInput }) =>
      api.post(`/admin/delivery/${orderId}/assign`, input),
    onSuccess: async () => {
      toast.showSuccess('delivery_assigned');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useManagedUsers(filters: { role?: Role; status?: string; q?: string }) {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.status) params.set('status', filters.status);
  if (filters.q?.trim()) params.set('q', filters.q.trim());

  return useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () => api.get<ManagedUserDto[]>(`/admin/users?${params.toString()}`),
  });
}

export function useSetUserStatus() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ userId, status, reason }: { userId: string; status: 'active' | 'suspended'; reason: string }) =>
      api.post(`/admin/users/${userId}/status`, { status, reason }),
    onSuccess: async () => {
      toast.showSuccess('account_updated');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

/**
 * Promotion and demotion. The API refuses this for anyone but a super admin, and the UI hides it
 * — but the hiding is cosmetic, and the refusal is what actually protects it.
 */
export function useSetUserRole() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.post(`/admin/users/${userId}/role`, { role }),
    onSuccess: async () => {
      toast.showSuccess('role_updated');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
}

export function useSetContactStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContactStatus }) =>
      apiRequest(`/content/contact/messages/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contact-messages'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
  });
}
