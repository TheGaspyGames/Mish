import mongoose from 'mongoose';

const handSchema = new mongoose.Schema(
  {
    playerId: { type: String, index: true },
    guildId: String,
    channelId: String,
    betAmount: Number,
    initialHand: {
      cards: [String],
      total: Number,
    },
    dealerCard: String,
    state: {
      key: { type: String, index: true },
      playerCards: [String],
      playerTotal: Number,
      dealerUpCard: String,
      isSoft: Boolean,
      isPair: Boolean,
      canDouble: Boolean,
      canSplit: Boolean,
    },
    decision: { type: String, enum: ['hit', 'stand', 'double', 'split'] },
    finalHand: {
      cards: [String],
      total: Number,
      result: { type: String, enum: ['win', 'lose', 'tie'] },
    },
  },
  { timestamps: true }
);

export const Hand = mongoose.model('Hand', handSchema);
