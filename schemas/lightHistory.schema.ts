import mongoose, { Schema } from 'mongoose';
import { ILightHistory } from '../interfaces';
import { dbLightHistoryCollection } from '../utils';

export type ILightHistoryDocument = mongoose.Document & ILightHistory;

const lightHistorySchema = new Schema<ILightHistory>({
  timestamp: { type: Date, default: Date.now, required: true },
  status: { type: Boolean, required: true },
});

// Create indexes for better query performance
lightHistorySchema.index({ timestamp: -1 }); // For finding last entry
lightHistorySchema.index({ timestamp: 1, status: 1 }); // For statistics queries

const LightHistory = mongoose.model(dbLightHistoryCollection, lightHistorySchema);

export default LightHistory;
