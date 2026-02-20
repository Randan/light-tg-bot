import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class LightRecord extends Document {
  @Prop({ required: true })
  status: boolean;

  @Prop({ type: [Number], default: [] })
  userIds: number[];

  @Prop({ required: true, unique: true })
  deviceId: string;
}

export const LightRecordSchema = SchemaFactory.createForClass(LightRecord);
LightRecordSchema.index({ deviceId: 1 });
