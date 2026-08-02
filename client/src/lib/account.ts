import type {
  AccountDto,
  KycDocumentKind,
  OtpRequestResult,
  ReviewQueueItemDto,
  UpdateProfileInput,
} from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from './api.js';
import { useAuth } from './auth.js';
import { useToast } from './toast.js';

export const accountKey = ['account'] as const;

/**
 * The account payload drives which controls the UI offers, so it is fetched rather than
 * inferred from the login response. `canListProduce` and `bidCeilingPoisha` are decided by the
 * server, and a client that guessed them would show a button the API then refuses.
 */
export function useAccount() {
  return useQuery({
    queryKey: accountKey,
    queryFn: () => api.get<AccountDto>('/account'),
    // Verification state changes through admin action, not user action, so a farmer waiting on
    // approval should see it land without a manual refresh.
    refetchInterval: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateProfileInput) => apiRequest<AccountDto>('/account', {
      method: 'PATCH',
      body: input,
    }),
    onSuccess: (account) => {
      queryClient.setQueryData(accountKey, account);
      toast.showSuccess('profile_updated');
    },
  });
}

export function useChangePassword() {
  const toast = useToast();
  const logout = useAuth((s) => s.logout);

  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post('/account/password', input),
    onSuccess: async () => {
      toast.showSuccess('password_changed');
      // Every session was revoked server-side, including this one. Signing out locally keeps
      // the UI honest instead of leaving the user on a token that is already dead.
      await logout();
    },
  });
}

export function useRequestOtp() {
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { purpose: 'verify_email' | 'change_email'; email?: string }) =>
      api.post<OtpRequestResult>('/account/otp/request', input),
    onSuccess: () => toast.showSuccess('otp_sent'),
  });
}

/**
 * Verifies the address, or completes a change to a new one.
 *
 * Unlike the old phone flow this does not sign anyone out. The number is still the login
 * identifier, so changing the email address does not invalidate the session — there is nothing to
 * re-authenticate.
 */
export function useVerifyOtp() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: {
      code: string;
      purpose: 'verify_email' | 'change_email';
      email?: string;
    }) => api.post<{ emailChanged: boolean }>('/account/otp/verify', input),
    onSuccess: async (result) => {
      toast.showSuccess(result.emailChanged ? 'email_changed' : 'email_verified');
      await queryClient.invalidateQueries({ queryKey: accountKey });
    },
  });
}

export function useUploadKycDocument() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ kind, file }: { kind: KycDocumentKind; file: Blob }) => {
      const form = new FormData();
      form.append('document', file, `${kind}.jpg`);
      return apiRequest<{ kind: KycDocumentKind }>(`/account/kyc/documents/${kind}`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: async () => {
      toast.showSuccess('document_uploaded');
      await queryClient.invalidateQueries({ queryKey: accountKey });
    },
  });
}

export function useSubmitKyc() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: {
      nidNumber: string;
      fullNameOnNid: string;
      farmSizeAcres: number;
      cropsGrown: string[];
      note?: string;
    }) => api.post('/account/kyc/submit', input),
    onSuccess: async () => {
      toast.showSuccess('kyc_submitted');
      await queryClient.invalidateQueries({ queryKey: accountKey });
    },
  });
}

// ---- admin ----

export function useReviewQueue() {
  return useQuery({
    queryKey: ['admin', 'review-queue'],
    queryFn: () => api.get<ReviewQueueItemDto[]>('/account/admin/review-queue'),
    // Signed document URLs are short-lived, so a stale queue would render broken images.
    staleTime: 60_000,
  });
}

export function useReviewDecision() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { userId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      api.post('/account/admin/review', input),
    onSuccess: async () => {
      toast.showSuccess('review_recorded');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] });
    },
  });
}
