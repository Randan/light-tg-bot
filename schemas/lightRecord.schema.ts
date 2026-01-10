import mongoose, { Schema } from 'mongoose';
import { dbLightCollection } from '../utils';
import { ILightRecord } from '../interfaces';

const lightRecordSchema = new Schema<ILightRecord>({
  status: Boolean,
  userIds: [Number],
  deviceId: { type: String, unique: true },
});

// Create index for faster queries
lightRecordSchema.index({ deviceId: 1 });

const LightRecords = mongoose.model(dbLightCollection, lightRecordSchema);

export default LightRecords;
