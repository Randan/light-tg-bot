import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class LightHistoryDoc extends Document {
  @Prop({ default: Date.now, required: true })
  timestamp: Date;

  @Prop({ required: true })
  status: boolean;
}

export const LightHistorySchema = SchemaFactory.createForClass(LightHistoryDoc);
LightHistorySchema.index({ timestamp: -1 });
LightHistorySchema.index({ timestamp: 1, status: 1 });
