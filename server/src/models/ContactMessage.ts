import { Schema, model, Types, type InferSchemaType, type Model } from 'mongoose';

/**
 * A message from the contact form.
 *
 * Written to the database rather than emailed. A contact form that only sends mail loses every
 * message the day the mail provider stops working — which is exactly the situation this project
 * is in — and the sender gets a cheerful confirmation either way. Stored, it survives, and the
 * admin reads it in one place.
 */
const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true },

    status: { type: String, enum: ['new', 'read', 'archived'], default: 'new', index: true },

    /**
     * Set when a signed-in user writes in, so a reply can be tied to their account. Null for a
     * visitor, which is most of them — requiring an account to report a problem would silence
     * the people most likely to have one.
     */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/** The admin inbox: unread first, newest first. */
contactMessageSchema.index({ status: 1, createdAt: -1 });

export type ContactMessageDoc = InferSchemaType<typeof contactMessageSchema> & {
  _id: Types.ObjectId;
};

export const ContactMessage: Model<ContactMessageDoc> = model<ContactMessageDoc>(
  'ContactMessage',
  contactMessageSchema,
);
