import { KYC_DOCUMENT_KINDS, type KycDocumentKind } from '@krishibid/shared';
import type { Request, Response } from 'express';
import { badRequest } from '../utils/errors.js';
import * as accountService from '../services/account.service.js';
import { sniffImage } from '../services/diagnosis.service.js';
import * as kycService from '../services/kyc.service.js';
import * as otpService from '../services/otp.service.js';

// ---- profile ----

export async function me(req: Request, res: Response): Promise<void> {
  res.json(await accountService.getAccount(req.user!.id));
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  res.json(await accountService.updateProfile(req.user!.id, req.body));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await accountService.changePassword(
    req.user!.id,
    req.body.currentPassword,
    req.body.newPassword,
  );
  // 204: the client must re-authenticate anyway, since other sessions were just revoked.
  res.status(204).send();
}

// ---- phone verification / change ----

export async function requestOtp(req: Request, res: Response): Promise<void> {
  const { purpose, phone } = req.body as {
    purpose: 'verify_current' | 'change_phone';
    phone?: string;
  };

  // Checked before sending an SMS rather than after, so a blocked change does not cost the
  // user a wasted code and a 60-second cooldown.
  if (purpose === 'change_phone') {
    await accountService.assertPhoneChangeAllowed(req.user!.id);
  }

  res.json(await otpService.requestOtp(req.user!.id, purpose, phone));
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { code, purpose } = req.body as {
    code: string;
    purpose: 'verify_current' | 'change_phone';
  };

  const result = await otpService.verifyOtp(req.user!.id, code, purpose);

  res.json({
    ...result,
    // A phone change revokes every session including this one, so the client must know to
    // send the user back to login rather than leaving them on a dead token.
    reauthRequired: result.phoneChanged,
  });
}

// ---- KYC ----

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  if (!req.file) throw badRequest('no_image', 'attach the document image');

  const kind = String(req.params.kind) as KycDocumentKind;
  if (!(KYC_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    throw badRequest('bad_document_kind', `kind must be one of: ${KYC_DOCUMENT_KINDS.join(', ')}`);
  }

  // Magic-byte check, not the client-declared MIME type, which is trivially spoofed.
  if (!sniffImage(req.file.buffer)) {
    throw badRequest('bad_image', 'that file is not a valid JPEG, PNG or WebP');
  }

  res.status(201).json(await kycService.uploadDocument(req.user!.id, kind, req.file.buffer));
}

export async function submitKyc(req: Request, res: Response): Promise<void> {
  res.status(201).json(await kycService.submitApplication(req.user!.id, req.body));
}

// ---- admin ----

export async function reviewQueue(_req: Request, res: Response): Promise<void> {
  res.json(await kycService.reviewQueue());
}

export async function reviewDecision(req: Request, res: Response): Promise<void> {
  const { userId, decision, reason } = req.body as {
    userId: string;
    decision: 'approve' | 'reject';
    reason?: string;
  };
  res.json(await kycService.decide(req.user!.id, userId, decision, reason));
}

export async function setAccountStatus(req: Request, res: Response): Promise<void> {
  const { userId, status, reason } = req.body as {
    userId: string;
    status: 'active' | 'suspended';
    reason: string;
  };
  await kycService.setAccountStatus(req.user!.id, userId, status, reason);
  res.status(204).send();
}
