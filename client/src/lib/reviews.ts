import type {
  CreateReviewInput,
  ReviewDto,
  ReviewableOrderDto,
  SupplierProfileDto,
} from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { useToast } from './toast.js';

/** Open to guests — the profile is public, and requiring a login to read it would defeat it. */
export function useSupplierProfile(id: string) {
  return useQuery({
    queryKey: ['supplier', id],
    queryFn: () => api.get<SupplierProfileDto>(`/suppliers/${id}`),
    enabled: Boolean(id),
  });
}

/** Completed orders the buyer has not reviewed. Empty for every other role. */
export function useReviewableOrders(enabled = true) {
  return useQuery({
    queryKey: ['reviews', 'pending'],
    queryFn: () => api.get<ReviewableOrderDto[]>('/reviews/pending'),
    enabled,
  });
}

export function useCreateReview() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateReviewInput) => api.post<ReviewDto>('/reviews', input),
    onSuccess: async () => {
      toast.showSuccess('review_posted');
      // The prompt that offered this order, and the supplier's page if it is open behind.
      await queryClient.invalidateQueries({ queryKey: ['reviews', 'pending'] });
      await queryClient.invalidateQueries({ queryKey: ['supplier'] });
    },
  });
}
