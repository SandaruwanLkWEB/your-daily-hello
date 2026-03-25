import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkflowApi } from '@/hooks/useWorkflowApi';
import type { GroupingRun } from '@/types/workflow';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Map, Calendar, Route, Clock, MapPin } from 'lucide-react';
import api from '@/lib/api';

// Lazy-load RouteMap so maplibre-gl is in its own chunk
const RouteMap = lazy(() => import('@/components/map/RouteMap'));

interface MapConfigResponse {
  provider?: string;
  mapStyleUrl?: string;
  routesAvailable?: boolean;
  mapsAvailable?: boolean;
  matrixAvailable?: boolean;
  optimizationAvailable?: boolean;
  degraded?: boolean;
  warnings?: string[];
}

export default function RouteMapPage() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const wfApi = useWorkflowApi();
  const [run, setRun] = useState<GroupingRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [mapStyleUrl, setMapStyleUrl] = useState('');
  const [mapConfig, setMapConfig] = useState<MapConfigResponse | null>(null);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    (async () => {
      try {
        const [runData, mapConfigResponse] = await Promise.all([
          wfApi.fetchDailyGroupingRun(date),
          api.get('/location/map-config').then(r => r.data?.data ?? r.data).catch(() => null),
        ]);
        setRun(runData);
        setMapConfig(mapConfigResponse);
        if (mapConfigResponse?.mapStyleUrl) setMapStyleUrl(mapConfigResponse.mapStyleUrl);
      } finally {
        setLoading(false);
      }
    })();
  }, [date]);

  const activeGroups = useMemo(
    () => run?.groups?.filter(g => g.status !== 'CANCELLED') || [],
    [run],
  );

  const mapGroups = useMemo(
    () => activeGroups.map(g => ({
      id: g.id,
      group_code: g.group_code,
      corridor_label: g.corridor_label,
      route_geometry: g.route_geometry,
      center_lat: g.center_lat,
      center_lng: g.center_lng,
      members: g.members?.map(m => ({
        lat: m.lat_snapshot,
        lng: m.lng_snapshot,
        label: m.full_name || `EMP-${m.employee_id}`,
        stopNumber: m.stop_sequence,
      })) || [],
    })),
    [activeGroups],
  );

  const totalDistKm = useMemo(
    () => activeGroups.reduce((s, g) => s + (Number(g.estimated_distance_km) || 0), 0),
    [activeGroups],
  );
  const totalDurMin = useMemo(
    () => Math.round(activeGroups.reduce((s, g) => s + (Number(g.estimated_duration_seconds) || 0), 0) / 60),
    [activeGroups],
  );
  const amazonGroups = useMemo(
    () => activeGroups.filter(g => g.routing_source === 'AMAZON_ROUTE').length,
    [activeGroups],
  );

  const handleGroupSelect = useCallback(
    (id: number | null) => setSelectedGroupId(id),
    [],
  );

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-[500px] rounded-xl" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Map className="h-5 w-5 text-primary" /> Daily Route Map
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
            <Calendar className="h-3.5 w-3.5" />{date}
            {run && ` · Run #${run.run_number} · ${activeGroups.length} groups`}
            {run?.request_count && ` · ${run.request_count} requests`}
            {run?.department_count && ` · ${run.department_count} depts`}
          </p>
        </div>
      </div>

      {/* Routing summary badges */}
      <div className="flex flex-wrap gap-2">
        {mapConfig?.provider && <Badge variant="outline">{mapConfig.provider}</Badge>}
        <Badge variant={mapConfig?.degraded === false ? 'default' : 'secondary'}>
          {mapConfig?.degraded === false ? 'Amazon-first routing' : 'Degraded mode'}
        </Badge>
        {amazonGroups > 0 && (
          <Badge variant="default" className="text-[10px]">
            {amazonGroups}/{activeGroups.length} with Amazon routes
          </Badge>
        )}
        {totalDistKm > 0 && (
          <Badge variant="outline" className="text-[10px]">
            <Route className="h-3 w-3 mr-1" />{totalDistKm.toFixed(1)} km total
          </Badge>
        )}
        {totalDurMin > 0 && (
          <Badge variant="outline" className="text-[10px]">
            <Clock className="h-3 w-3 mr-1" />{totalDurMin} min total
          </Badge>
        )}
      </div>

      {mapConfig?.warnings?.length ? (
        <Card>
          <CardContent className="p-3 space-y-1">
            {mapConfig.warnings.map((warning, idx) => (
              <p key={idx} className="text-xs text-muted-foreground">⚠ {warning}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto">
          <Button
            variant={selectedGroupId === null ? 'default' : 'outline'}
            size="sm"
            className="w-full text-xs"
            onClick={() => setSelectedGroupId(null)}
          >
            Show All Groups
          </Button>

          {activeGroups.map((g, i) => {
            const distKm = g.estimated_distance_km ? Number(g.estimated_distance_km).toFixed(1) : null;
            const durMin = g.estimated_duration_seconds ? Math.round(Number(g.estimated_duration_seconds) / 60) : null;

            return (
              <Card
                key={g.id}
                className={`cursor-pointer transition-all ${selectedGroupId === g.id ? 'ring-2 ring-primary' : 'hover:bg-muted/50'}`}
                onClick={() => setSelectedGroupId(selectedGroupId === g.id ? null : g.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: ['#2563eb','#dc2626','#16a34a','#ea580c','#7c3aed','#0891b2','#be185d','#65a30d','#c026d3','#0d9488'][i % 10] }}
                      />
                      <span className="font-mono text-xs font-medium">{g.group_code}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{g.employee_count} emp</Badge>
                  </div>
                  {g.corridor_label && <p className="text-[10px] text-muted-foreground mt-1">{g.corridor_label}</p>}
                  {(distKm || durMin !== null) && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                      {distKm && <span className="flex items-center gap-0.5"><MapPin className="h-2.5 w-2.5" />{distKm} km</span>}
                      {durMin !== null && <span className="flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{durMin} min</span>}
                    </p>
                  )}
                  <Badge
                    variant={g.routing_source === 'AMAZON_ROUTE' ? 'default' : 'outline'}
                    className="text-[9px] mt-1"
                  >
                    {g.routing_source === 'AMAZON_ROUTE' ? 'Amazon Route' : 'Haversine'}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-0">
              <Suspense fallback={<div className="h-[550px] flex items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
                <RouteMap
                  groups={mapGroups}
                  mapStyleUrl={mapStyleUrl || undefined}
                  selectedGroupId={selectedGroupId}
                  onGroupSelect={handleGroupSelect}
                  className="h-[550px]"
                />
              </Suspense>
            </CardContent>
          </Card>

          {run?.routing_warning && (
            <p className="text-xs text-muted-foreground mt-2 italic">⚠ {run.routing_warning}</p>
          )}
        </div>
      </div>
    </div>
  );
}
