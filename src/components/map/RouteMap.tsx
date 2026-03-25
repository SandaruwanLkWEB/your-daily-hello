import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Stop {
  lat: number;
  lng: number;
  label?: string;
  stopNumber?: number;
}

interface RouteGroup {
  id: number;
  group_code: string;
  corridor_label?: string;
  route_geometry?: number[][];
  center_lat?: number;
  center_lng?: number;
  members?: Stop[];
  color?: string;
}

interface RouteMapProps {
  groups: RouteGroup[];
  depotLat?: number;
  depotLng?: number;
  mapStyleUrl?: string;
  selectedGroupId?: number | null;
  onGroupSelect?: (groupId: number) => void;
  vehiclePosition?: { lat: number; lng: number } | null;
  className?: string;
}

const SEGMENT_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#ea580c', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d', '#c026d3', '#0d9488',
];

function classifyMapError(event: any): { title: string; detail: string } {
  const msg = String(event?.error?.message || event?.message || event?.error || '');
  const status = event?.error?.status ?? event?.status;

  if (status === 403 || msg.includes('403') || msg.includes('Forbidden')) {
    return {
      title: 'Map authentication failed',
      detail: 'The API key does not have permission for this map resource. Check GetStyleDescriptor / GetTile access.',
    };
  }
  if (status === 401 || msg.includes('401') || msg.includes('Unauthorized')) {
    return {
      title: 'Map authentication failed',
      detail: 'The API key was rejected. Verify it is valid and not expired.',
    };
  }
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch') || msg.includes('CORS')) {
    return {
      title: 'Network error loading map',
      detail: 'Could not reach the map tile server. Check network connectivity and CORS configuration.',
    };
  }
  if (msg.includes('style') || msg.includes('Style')) {
    return {
      title: 'Map style failed to load',
      detail: `The style descriptor could not be parsed or fetched. ${msg}`,
    };
  }
  if (msg.includes('tile') || msg.includes('Tile') || msg.includes('source')) {
    return {
      title: 'Tile loading error',
      detail: `Some map tiles failed to load. The map may still be partially usable. ${msg}`,
    };
  }

  return {
    title: 'Map rendering error',
    detail: msg || 'An unknown MapLibre error occurred.',
  };
}

export default function RouteMap({
  groups, depotLat = 6.0477241, depotLng = 80.2479661,
  mapStyleUrl, selectedGroupId, onGroupSelect, vehiclePosition, className,
}: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState<{ title: string; detail: string } | null>(null);

  useEffect(() => {
    if (!mapStyleUrl) {
      setMapError({
        title: 'No map style URL configured',
        detail: 'The backend did not return a map style URL. Ensure AMAZON_LOCATION_API_KEY is set and maps are enabled.',
      });
      return;
    }

    if (!mapContainer.current || map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyleUrl,
      center: [depotLng, depotLat],
      zoom: 10,
    });

    m.addControl(new maplibregl.NavigationControl(), 'top-right');
    m.on('load', () => {
      setLoaded(true);
      setMapError(null);
    });
    m.on('error', (event) => {
      console.error('MapLibre error:', event?.error || event);
      const classified = classifyMapError(event);
      // Tile errors are non-fatal — don't replace a working map
      if (classified.title === 'Tile loading error' && loaded) {
        console.warn('Non-fatal tile error:', classified.detail);
        return;
      }
      setMapError(classified);
    });
    map.current = m;

    return () => {
      m.remove();
      map.current = null;
      setLoaded(false);
    };
  }, [mapStyleUrl, depotLat, depotLng]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;

    const existingLayers = m.getStyle()?.layers || [];
    for (const layer of existingLayers) {
      if (layer.id.startsWith('route-') || layer.id.startsWith('stops-')) {
        m.removeLayer(layer.id);
      }
    }
    const existingSources = Object.keys(m.getStyle()?.sources || {});
    for (const src of existingSources) {
      if (src.startsWith('route-') || src.startsWith('stops-')) {
        m.removeSource(src);
      }
    }

    document.querySelectorAll('.route-map-marker').forEach(el => el.remove());

    const depotEl = document.createElement('div');
    depotEl.className = 'route-map-marker';
    depotEl.style.cssText = 'width:20px;height:20px;background:#000;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer;';
    depotEl.title = 'Depot';
    new maplibregl.Marker({ element: depotEl }).setLngLat([depotLng, depotLat]).addTo(m);

    const bounds = new maplibregl.LngLatBounds([depotLng, depotLat], [depotLng, depotLat]);
    const visibleGroups = selectedGroupId ? groups.filter(g => g.id === selectedGroupId) : groups;

    visibleGroups.forEach((group, idx) => {
      const color = group.color || SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
      const sourceId = `route-${group.id}`;
      const opacity = selectedGroupId && group.id !== selectedGroupId ? 0.2 : 0.85;

      if (group.route_geometry && group.route_geometry.length > 1) {
        m.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: group.route_geometry },
          },
        });

        m.addLayer({
          id: `route-line-${group.id}`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': selectedGroupId === group.id ? 5 : 3, 'line-opacity': opacity },
        });

        for (const coord of group.route_geometry) {
          bounds.extend(coord as [number, number]);
        }
      } else if (group.members && group.members.length > 0) {
        const coords: number[][] = [[depotLng, depotLat]];
        for (const stop of group.members) {
          coords.push([stop.lng, stop.lat]);
        }

        m.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        });

        m.addLayer({
          id: `route-line-${group.id}`,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': 2, 'line-opacity': opacity, 'line-dasharray': [4, 3] },
        });
      }

      const stops = group.members || [];
      stops.forEach((stop, si) => {
        bounds.extend([stop.lng, stop.lat]);

        const el = document.createElement('div');
        el.className = 'route-map-marker';
        el.style.cssText = `width:24px;height:24px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;cursor:pointer;`;
        el.textContent = String(stop.stopNumber ?? si + 1);
        el.title = `${group.group_code} Stop #${stop.stopNumber ?? si + 1}${stop.label ? `: ${stop.label}` : ''}`;
        el.onclick = () => onGroupSelect?.(group.id);

        new maplibregl.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(m);
      });
    });

    if (vehiclePosition) {
      const vEl = document.createElement('div');
      vEl.className = 'route-map-marker';
      vEl.style.cssText = 'width:16px;height:16px;background:#f59e0b;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(245,158,11,.6);';
      vEl.title = 'Vehicle (Live)';
      new maplibregl.Marker({ element: vEl }).setLngLat([vehiclePosition.lng, vehiclePosition.lat]).addTo(m);
      bounds.extend([vehiclePosition.lng, vehiclePosition.lat]);
    }

    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [groups, loaded, selectedGroupId, vehiclePosition, depotLat, depotLng, onGroupSelect]);

  if (!mapStyleUrl || mapError) {
    return (
      <div className={`w-full h-full min-h-[400px] rounded-lg overflow-hidden border bg-muted/30 flex items-center justify-center p-6 text-center ${className || ''}`}>
        <div className="max-w-md">
          <p className="font-medium text-foreground">{mapError?.title || 'Map unavailable'}</p>
          <p className="text-sm text-muted-foreground mt-1">{mapError?.detail || 'No map style URL was returned by the backend.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapContainer} className={`w-full h-full min-h-[400px] rounded-lg overflow-hidden ${className || ''}`} />
  );
}
