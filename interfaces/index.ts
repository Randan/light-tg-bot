export interface ILightRecord {
  status: boolean;
  userIds: number[];
  deviceId: string;
}

export interface ILightHistory {
  timestamp: Date;
  status: boolean;
}
