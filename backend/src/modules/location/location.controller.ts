import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoutingService } from '../routing/routing.service';
import { Roles } from '../../common/decorators';
import { RolesGuard } from '../../common/guards';
import { AppRole } from '../../common/enums';

@ApiTags('Location')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('location')
export class LocationController {
  constructor(private routing: RoutingService) {}

  @Get('map-config')
  @Roles(AppRole.TRANSPORT_AUTHORITY, AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.HR, AppRole.PLANNING)
  getMapConfig() {
    const avail = this.routing.getAvailability();
    const styleUrl = this.routing.getMapStyleUrl();
    return {
      provider: avail.provider,
      region: avail.region || 'unknown',
      mapStyleUrl: styleUrl,
      mapStyleUrlPresent: !!styleUrl,
      routesAvailable: avail.routes,
      mapsAvailable: avail.maps,
      matrixAvailable: avail.matrix,
      optimizationAvailable: avail.optimization,
      trackingAvailable: avail.tracking,
      geofenceAvailable: avail.geofences,
      degraded: avail.degraded,
      warnings: this.getWarnings(avail),
    };
  }

  @Post('calculate-route')
  @Roles(AppRole.TRANSPORT_AUTHORITY, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  async calculateRoute(@Body() body: { waypoints: { lat: number; lng: number }[] }) {
    const result = await this.routing.calculateRoute(body.waypoints);
    return result || { error: 'Routing not available', fallback: true };
  }

  @Get('tracker/:vehicleId')
  @Roles(AppRole.TRANSPORT_AUTHORITY, AppRole.ADMIN, AppRole.SUPER_ADMIN, AppRole.HR)
  async getVehiclePosition(@Param('vehicleId') vehicleId: string) {
    return {
      trackingAvailable: false,
      reason: 'Trackers require IAM/SigV4 server-side auth — will be enabled in Phase 2.',
    };
  }

  @Post('tracker/:vehicleId')
  @Roles(AppRole.TRANSPORT_AUTHORITY, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  async updateVehiclePosition(
    @Param('vehicleId') vehicleId: string,
    @Body() body: { lat: number; lng: number },
  ) {
    return {
      success: false,
      trackingAvailable: false,
      reason: 'Trackers require IAM/SigV4 server-side auth — will be enabled in Phase 2.',
    };
  }

  @Get('geofences')
  @Roles(AppRole.TRANSPORT_AUTHORITY, AppRole.ADMIN, AppRole.SUPER_ADMIN)
  async listGeofences() {
    return {
      geofenceAvailable: false,
      reason: 'Geofences require IAM/SigV4 server-side auth — will be enabled in Phase 2.',
      items: [],
    };
  }

  private getWarnings(avail: any): string[] {
    const w: string[] = [];
    if (!avail.routes) w.push('Amazon Routes V2 unavailable — routing uses haversine fallback.');
    if (!avail.maps) w.push('Amazon Maps V2 unavailable — map rendering may be limited.');
    if (!avail.tracking) w.push('Trackers disabled — requires IAM/SigV4 auth (Phase 2).');
    if (!avail.geofences) w.push('Geofences disabled — requires IAM/SigV4 auth (Phase 2).');
    if (avail.degraded) w.push('System is in DEGRADED mode — grouping uses haversine fallback instead of road distances.');
    return w;
  }
}
