import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransportRequestsController } from './transport-requests.controller';
import { TransportRequestsService } from './transport-requests.service';
import {
  TransportRequest,
  TransportRequestEmployee,
  RequestStatusHistory,
  ApprovalHistory,
} from './transport-request.entity';
import { Department } from '../departments/department.entity';
import { Employee } from '../employees/employee.entity';
import { User } from '../users/user.entity';
import { DailyLock } from '../daily-lock/daily-lock.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransportRequest,
      TransportRequestEmployee,
      RequestStatusHistory,
      ApprovalHistory,
      Department,
      Employee,
      User,
      DailyLock,
    ]),
  ],
  controllers: [TransportRequestsController],
  providers: [TransportRequestsService],
  exports: [TransportRequestsService],
})
export class TransportRequestsModule {}
