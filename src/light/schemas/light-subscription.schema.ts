import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class LightSubscription extends Document {
  @Prop({ type: [Number], default: [] })
  chatIds: number[];

  @Prop({ required: true, unique: true })
  deviceId: string;
}

export const LightSubscriptionSchema = SchemaFactory.createForClass(LightSubscription);
