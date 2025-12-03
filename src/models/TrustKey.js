import mongoose from 'mongoose';

const trustKeySchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true, required: true },
    used: { type: Boolean, default: false },
    usedBy: { type: String, default: null },
    usedAt: { type: Date, default: null },
    createdBy: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

export const TrustKey = mongoose.model('TrustKey', trustKeySchema);
