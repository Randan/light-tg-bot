import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface OutageSlot {
  /** Minutes from the start of the day (Kyiv time). */
  start: number;
  end: number;
  type: string;
}

/**
 * One version of the YASNO schedule for a group and a day. A new document is
 * stored only when the status or the slots change, so the collection is the
 * full history of schedule changes; the latest one per date is the current one.
 */
@Schema()
export class OutageSchedule extends Document {
  /** Kyiv date, YYYY-MM-DD. */
  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  group: string;

  /** ScheduleApplies | NoOutages | WaitingForSchedule | EmergencyShutdowns */
  @Prop({ required: true })
  status: string;

  @Prop({ type: [{ start: Number, end: Number, type: { type: String } }], default: [] })
  slots: OutageSlot[];

  /** When YASNO last updated the schedule. */
  @Prop()
  updatedOn?: Date;

  /** When the bot first saw this version. */
  @Prop({ required: true, default: Date.now })
  fetchedAt: Date;
}

export const OutageScheduleSchema = SchemaFactory.createForClass(OutageSchedule);
OutageScheduleSchema.index({ date: 1, fetchedAt: -1 });
