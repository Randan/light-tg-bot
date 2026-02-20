import { Global, Module } from '@nestjs/common';
import { NotifyAdminService } from './notify-admin.service';

@Global()
@Module({
  providers: [NotifyAdminService],
  exports: [NotifyAdminService],
})
export class NotifyAdminModule {}
