import {
  SIGNUP_TOKEN_HEADER,
  type ApprovalStatusDto,
  type CompleteRegistrationResult,
  type KycDocumentKind,
  type OpaqueRequestResult,
  type StartRegistrationResult,
  type VerifyRegistrationResult,
} from '@krishibid/shared';
import { useMutation } from '@tanstack/react-query';
import { api, apiRequest, setAccessToken } from './api.js';
import { useAuth } from './auth.js';
import { useToast } from './toast.js';

/**
 * The signup flow's client half.
 *
 * Nobody is authenticated during any of this, so none of these calls carry a bearer token. The
 * two that do real work carry the signup token instead — issued only after a code sent to a real
 * inbox came back, which is what stops the document endpoint being an open image dump.
 */

export interface SignupDraft {
  name: string;
  phone: string;
  email: string;
  district: string;
  role: 'farmer' | 'buyer';
  password: string;
}

/**
 * `meta.silent` throughout the wizard.
 *
 * The form renders each failure next to the field it belongs to — a taken phone number under the
 * phone, a malformed NID under the NID. A floating toast saying "some details are not valid" on
 * top of that is noise, and it is the wrong altitude for a mistyped digit.
 */
const inlineErrors = { meta: { silent: true } } as const;

export function useStartRegistration() {
  return useMutation({
    ...inlineErrors,
    mutationFn: (input: SignupDraft & { locale: 'bn' | 'en' }) =>
      api.post<StartRegistrationResult>('/auth/register/start', input),
  });
}

export function useVerifyRegistration() {
  return useMutation({
    ...inlineErrors,
    mutationFn: (input: { email: string; code: string }) =>
      api.post<VerifyRegistrationResult>('/auth/register/verify', input),
  });
}

export interface UploadProgress {
  /** 0..1, or null while the browser has not reported a total yet. */
  ratio: number | null;
}

/**
 * Uploads one document, reporting real progress.
 *
 * `XMLHttpRequest` rather than `fetch` for exactly one reason: fetch cannot report upload
 * progress. An NID photo on rural 2G takes tens of seconds, and an indeterminate spinner there is
 * indistinguishable from a hang — a user who cannot tell will retry and double-upload.
 */
export function uploadSignupDocument(
  signupToken: string,
  kind: KycDocumentKind,
  file: Blob,
  onProgress: (progress: UploadProgress) => void,
): Promise<{ kind: KycDocumentKind; missingDocuments: string[] }> {
  const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
  const url = `${base ? `${base}/api` : '/api'}/auth/register/documents/${kind}`;

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('document', file, `${kind}.jpg`);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader(SIGNUP_TOKEN_HEADER, signupToken);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      onProgress({ ratio: event.lengthComputable ? event.loaded / event.total : null });
    };

    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText) as unknown;
      } catch {
        // Left null — handled below as an unparseable response.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as { kind: KycDocumentKind; missingDocuments: string[] });
        return;
      }

      // Reject with the same shape the rest of the app throws, so one error renderer covers both.
      const error = payload as { error?: { code?: string; message?: string } } | null;
      reject(
        new UploadError(
          xhr.status,
          error?.error?.code ?? 'internal_error',
          error?.error?.message ?? `upload failed with ${xhr.status}`,
        ),
      );
    };

    xhr.onerror = () => reject(new UploadError(0, 'network_error', 'the upload did not reach us'));
    xhr.onabort = () => reject(new UploadError(0, 'network_error', 'the upload was cancelled'));

    xhr.send(form);
  });
}

export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Completes the registration.
 *
 * A buyer is created active and receives an access token here, so this also signs them in. A
 * farmer receives nothing — their account exists but cannot be logged into until it is approved,
 * and pretending otherwise would strand them on a token the server refuses.
 */
export function useCompleteRegistration() {
  const toast = useToast();

  return useMutation({
    ...inlineErrors,
    mutationFn: ({ signupToken, details }: { signupToken: string; details: unknown }) =>
      apiRequest<CompleteRegistrationResult>('/auth/register/complete', {
        method: 'POST',
        body: details ?? {},
        headers: { [SIGNUP_TOKEN_HEADER]: signupToken },
      }),
    onSuccess: async (result) => {
      if (result.next === 'awaiting_approval') {
        toast.showSuccess('registration_submitted');
        return;
      }

      if (result.accessToken) {
        setAccessToken(result.accessToken);
        // The refresh cookie is already set, so /auth/me is the shortest route to a user object.
        await useAuth.getState().restore();
      }
      toast.showSuccess('registration_complete');
    },
  });
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      api.post<OpaqueRequestResult>('/auth/password/forgot', { email }),
  });
}

export function useConfirmPasswordReset() {
  const toast = useToast();

  return useMutation({
    mutationFn: (input: { email: string; code: string; newPassword: string }) =>
      api.post<void>('/auth/password/reset', input),
    onSuccess: () => toast.showSuccess('password_reset'),
  });
}

// ---------------------------------------------------------------------------
// Approval status — no session involved
// ---------------------------------------------------------------------------

export function useRequestStatusCode() {
  return useMutation({
    mutationFn: (email: string) => api.post<OpaqueRequestResult>('/auth/status/request', { email }),
  });
}

/**
 * Looks up an application by address, and only asks for a code if the server demands one.
 *
 * Adaptive rather than configured on the client: whether a code is required is a server-side
 * setting, and a client that assumed either way would be wrong on one of the two deployments.
 * A `code_required` refusal is the signal to show the code step.
 */
export function useCheckStatus() {
  return useMutation({
    ...inlineErrors,
    mutationFn: (input: { email: string; code?: string }) =>
      api.post<ApprovalStatusDto>('/auth/status/check', input),
  });
}
