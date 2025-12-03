import mongoose from 'mongoose';

const trustUserSchema = new mongoose.Schema(
  {
    userId: { type: String, unique: true, index: true, required: true },
    hasTrust: { type: Boolean, default: false },
    assistsUsedToday: { type: Number, default: 0 },
    lastResetAt: { type: Date, default: () => new Date() },
    totalAssistsUsed: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

export const TrustUser = mongoose.model('TrustUser', trustUserSchema);
