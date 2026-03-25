import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting, HolidayCalendar } from './settings.entity';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AppRole } from '../../common/enums';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    @InjectRepository(SystemSetting) private settingsRepo: Repository<SystemSetting>,
  ) {}

  @Get()
  @Roles(AppRole.ADMIN, AppRole.SUPER_ADMIN)
  async getAll() {
    return this.settingsRepo.find({ order: { category: 'ASC', key: 'ASC' } });
  }

  @Patch()
  @Roles(AppRole.SUPER_ADMIN)
  async updateSettings(@Body() settings: { key: string; value: string }[]) {
    for (const s of settings) {
      await this.settingsRepo.upsert({ key: s.key, value: s.value, updated_at: new Date() }, ['key']);
    }
    return { message: 'Settings updated' };
  }
}
