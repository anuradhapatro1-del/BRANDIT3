import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Haven, UserLocationState } from '../data/havenData';
import { SeismicZone } from '../data/earthquakeScanData';
import { playTactileClick } from '../utils/audioSynth';

interface TacticalStreetMapProps {
  center: { lat: number; lng: number };
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  userLocation: UserLocationState;
  havens: Haven[];
  selectedHaven: Haven | null;
  onSelectHaven: (haven: Haven) => void;
  isEarthquakeScannerActive: boolean;
  seismicZones: SeismicZone[];
  onSelectSeismicZone: (zone: SeismicZone) => void;
  travelMode: 'WALKING' | 'DRIVING' | 'BICYCLING';
  styleTheme?: 'dark' | 'osm' | 'satellite';
  onThemeChange?: (theme: 'dark' | 'osm' | 'satellite') => void;
}

const TILE_SIZE = 256;

// Web Mercator EPSG:3857 projection
function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = scale * (lng + 180) / 360;
  const y = scale * (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI));
  return { x, y };
}

function unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

export const TacticalStreetMap: React.FC<TacticalStreetMapProps> = ({
  center,
  zoom,
  onZoomChange,
  userLocation,
  havens,
  selectedHaven,
  onSelectHaven,
  isEarthquakeScannerActive,
  seismicZones,
  onSelectSeismicZone,
  travelMode,
  styleTheme = 'dark',
  onThemeChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });
  const [mapCenter, setMapCenter] = useState(center);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [activePopupHaven, setActivePopupHaven] = useState<Haven | null>(null);

  const dragStartRef = useRef<{
    x: number;
    y: number;
    startCenter: { lat: number; lng: number };
  } | null>(null);

  // Synchronize internal mapCenter when target center changes externally
  useEffect(() => {
    setMapCenter(center);
    setPanOffset({ x: 0, y: 0 });
  }, [center.lat, center.lng]);

  // Keep track of container size
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        if (clientWidth > 0 && clientHeight > 0) {
          setDimensions({ width: clientWidth, height: clientHeight });
        }
      }
    };
    updateSize();

    const resizeObserver = new ResizeObserver(() => updateSize());
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Mouse & Touch Drag Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startCenter: mapCenter
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPanOffset({ x: dx, y: dy });
  };

  const handleMouseUp = () => {
    if (isDragging && dragStartRef.current) {
      const startWorld = project(dragStartRef.current.startCenter.lat, dragStartRef.current.startCenter.lng, zoom);
      const newWorld = {
        x: startWorld.x - panOffset.x,
        y: startWorld.y - panOffset.y
      };
      const newCenter = unproject(newWorld.x, newWorld.y, zoom);
      setMapCenter(newCenter);
      setPanOffset({ x: 0, y: 0 });
      dragStartRef.current = null;
      setIsDragging(false);
    }
  };

  // Touch handlers for mobile/tablets
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    setIsDragging(true);
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      startCenter: mapCenter
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || !dragStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.x;
    const dy = touch.clientY - dragStartRef.current.y;
    setPanOffset({ x: dx, y: dy });
  };

  const handleTouchEnd = () => {
    handleMouseUp();
  };

  // Mouse Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      onZoomChange(Math.min(zoom + 1, 18));
    } else if (e.deltaY > 0) {
      onZoomChange(Math.max(zoom - 1, 9));
    }
  };

  // Compute View Bounds
  const currentWorldCenter = useMemo(
    () => project(mapCenter.lat, mapCenter.lng, zoom),
    [mapCenter.lat, mapCenter.lng, zoom]
  );

  const viewCenter = {
    x: currentWorldCenter.x - panOffset.x,
    y: currentWorldCenter.y - panOffset.y
  };

  const viewLeft = viewCenter.x - dimensions.width / 2;
  const viewTop = viewCenter.y - dimensions.height / 2;

  // Visible tiles calculation
  const numTiles = Math.pow(2, zoom);
  const minTileX = Math.floor(viewLeft / TILE_SIZE);
  const maxTileX = Math.floor((viewLeft + dimensions.width) / TILE_SIZE);
  const minTileY = Math.max(0, Math.floor(viewTop / TILE_SIZE));
  const maxTileY = Math.min(numTiles - 1, Math.floor((viewTop + dimensions.height) / TILE_SIZE));

  const tiles = [];
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
      const left = tx * TILE_SIZE - viewLeft;
      const top = ty * TILE_SIZE - viewTop;
      const sub = ['a', 'b', 'c', 'd'][(wrappedX + ty) % 4];

      let tileUrl = `https://${sub}.basemaps.cartocdn.com/dark_all/${zoom}/${wrappedX}/${ty}.png`;
      if (styleTheme === 'osm') {
        tileUrl = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`;
      } else if (styleTheme === 'satellite') {
        tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${wrappedX}`;
      }

      tiles.push({
        key: `${zoom}-${tx}-${ty}-${styleTheme}`,
        url: tileUrl,
        left,
        top
      });
    }
  }

  // Calculate pixel positions for Haven markers
  const havenMarkers = useMemo(() => {
    return havens.map((haven) => {
      const world = project(haven.lat, haven.lng, zoom);
      const px = world.x - viewLeft;
      const py = world.y - viewTop;
      return {
        ...haven,
        px,
        py,
        isVisible:
          px >= -60 && px <= dimensions.width + 60 && py >= -60 && py <= dimensions.height + 60
      };
    });
  }, [havens, zoom, viewLeft, viewTop, dimensions.width, dimensions.height]);

  // User position pixel
  const userMarkerPx = useMemo(() => {
    if (!userLocation.coords) return null;
    const world = project(userLocation.coords.lat, userLocation.coords.lng, zoom);
    return {
      x: world.x - viewLeft,
      y: world.y - viewTop
    };
  }, [userLocation.coords, zoom, viewLeft, viewTop]);

  // Selected Haven pixel
  const selectedHavenPx = useMemo(() => {
    if (!selectedHaven) return null;
    const world = project(selectedHaven.lat, selectedHaven.lng, zoom);
    return {
      x: world.x - viewLeft,
      y: world.y - viewTop
    };
  }, [selectedHaven, zoom, viewLeft, viewTop]);

  // Seismic zones pixel calculation
  const seismicMarkers = useMemo(() => {
    if (!isEarthquakeScannerActive) return [];
    return seismicZones.map((zone) => {
      const world = project(zone.lat, zone.lng, zoom);
      const px = world.x - viewLeft;
      const py = world.y - viewTop;

      // Calculate radius in pixels for danger area
      const latRad = (zone.lat * Math.PI) / 180;
      const metersPerPixel = (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom);
      const radiusPx = Math.max(16, Math.min(180, zone.dangerRadiusMeters / metersPerPixel));

      return {
        ...zone,
        px,
        py,
        radiusPx,
        isVisible:
          px >= -radiusPx &&
          px <= dimensions.width + radiusPx &&
          py >= -radiusPx &&
          py <= dimensions.height + radiusPx
      };
    });
  }, [isEarthquakeScannerActive, seismicZones, zoom, viewLeft, viewTop, dimensions.width, dimensions.height]);

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      className={`relative w-full h-full select-none overflow-hidden bg-[#030712] ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* 1. TILE LAYER */}
      <div className="absolute inset-0 pointer-events-none">
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.url}
            alt=""
            loading="lazy"
            decoding="async"
            style={{
              position: 'absolute',
              left: `${t.left}px`,
              top: `${t.top}px`,
              width: `${TILE_SIZE}px`,
              height: `${TILE_SIZE}px`,
              opacity: styleTheme === 'dark' ? 0.95 : 1
            }}
            className="transition-opacity duration-300 pointer-events-none"
          />
        ))}
      </div>

      {/* Grid Pattern Vignette Overlay */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(2,6,23,0.75)_100%)]"></div>

      {/* 2. VECTOR OVERLAYS (SVG Lines, Circles, Seismic Zones) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
        <defs>
          <linearGradient id="tacticalRouteGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.95" />
          </linearGradient>
          <filter id="glowRoute" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Seismic Earthquake Scanner Circular Danger & Safe Zones */}
        {isEarthquakeScannerActive &&
          seismicMarkers.map((zone) => {
            const isDanger = zone.type === 'danger_weak_tall';
            return (
              <g key={`zone-circ-${zone.id}`}>
                <circle
                  cx={zone.px}
                  cy={zone.py}
                  r={zone.radiusPx}
                  fill={isDanger ? 'rgba(239, 68, 68, 0.22)' : 'rgba(16, 185, 129, 0.2)'}
                  stroke={isDanger ? '#ef4444' : '#10b981'}
                  strokeWidth="2"
                  strokeDasharray={isDanger ? '4 3' : undefined}
                  className={isDanger ? 'animate-pulse' : ''}
                />
              </g>
            );
          })}

        {/* Tactical Route Polyline connecting User to Selected Haven */}
        {userMarkerPx && selectedHavenPx && (
          <g filter="url(#glowRoute)">
            <line
              x1={userMarkerPx.x}
              y1={userMarkerPx.y}
              x2={selectedHavenPx.x}
              y2={selectedHavenPx.y}
              stroke="url(#tacticalRouteGradient)"
              strokeWidth="4"
              strokeDasharray="8 6"
              strokeLinecap="round"
              className="animate-pulse"
            />
          </g>
        )}
      </svg>

      {/* 3. EARTHQUAKE SEISMIC MARKERS */}
      {isEarthquakeScannerActive &&
        seismicMarkers.map((zone) => {
          if (!zone.isVisible) return null;
          const isDanger = zone.type === 'danger_weak_tall';
          return (
            <div
              key={`zone-marker-${zone.id}`}
              onClick={(e) => {
                e.stopPropagation();
                playTactileClick();
                onSelectSeismicZone(zone);
              }}
              style={{
                left: `${zone.px}px`,
                top: `${zone.py}px`,
                transform: 'translate(-50%, -50%)'
              }}
              className="absolute z-20 cursor-pointer group flex flex-col items-center"
            >
              <div
                className={`w-8 h-8 rounded-xl border flex items-center justify-center shadow-xl transition-transform group-hover:scale-125 ${
                  isDanger
                    ? 'bg-[#1e0307] border-red-500 text-red-400 shadow-red-950'
                    : 'bg-[#02180f] border-emerald-400 text-emerald-300 shadow-emerald-950'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isDanger ? 'domain_disabled' : 'night_shelter'}
                </span>
              </div>
              <div
                className={`mt-1 border px-2 py-0.5 rounded-full text-[9px] font-mono font-bold shadow-xl whitespace-nowrap pointer-events-none ${
                  isDanger
                    ? 'bg-red-950/95 border-red-500 text-red-200'
                    : 'bg-emerald-950/95 border-emerald-500 text-emerald-200'
                }`}
              >
                {isDanger ? `RED: ${zone.collapseRiskPercent}% RISK` : 'GREEN: SAFE RESIDENCE'}
              </div>
            </div>
          );
        })}

      {/* 4. HAVEN MARKERS */}
      {havenMarkers.map((haven) => {
        if (!haven.isVisible) return null;
        const isSelected = selectedHaven?.id === haven.id;
        const isCritical = haven.category === 'hospital' || haven.category === 'fire';

        let pinBg = isCritical
          ? 'bg-[#180507] text-red-400 border-red-500 shadow-red-950'
          : haven.childFriendly
          ? 'bg-[#031c12] text-emerald-300 border-emerald-500 shadow-emerald-950'
          : 'bg-[#050e24] text-blue-400 border-blue-500 shadow-blue-950';

        let iconName = 'night_shelter';
        if (haven.category === 'hospital') iconName = 'local_hospital';
        if (haven.category === 'fire') iconName = 'local_fire_department';
        if (haven.category === 'safehouse') iconName = 'cottage';
        if (haven.category === 'peacekeeper') iconName = 'security';
        if (haven.category === 'water') iconName = 'water_drop';

        return (
          <div
            key={haven.id}
            onClick={(e) => {
              e.stopPropagation();
              playTactileClick();
              onSelectHaven(haven);
              setActivePopupHaven(haven);
            }}
            style={{
              left: `${haven.px}px`,
              top: `${haven.py}px`,
              transform: 'translate(-50%, -50%)'
            }}
            className={`absolute z-25 cursor-pointer transition-transform duration-200 ${
              isSelected ? 'scale-125 z-35' : 'hover:scale-115'
            }`}
          >
            <div className="relative group flex flex-col items-center">
              <span
                className={`absolute -inset-2 rounded-full pointer-events-none ${
                  isCritical
                    ? 'bg-red-500/35 animate-ping'
                    : haven.childFriendly
                    ? 'bg-emerald-500/30'
                    : 'bg-blue-500/30'
                }`}
              ></span>

              <div
                className={`w-9 h-9 rounded-xl border flex items-center justify-center shadow-xl relative ${pinBg}`}
              >
                <span className="material-symbols-outlined text-[18px]">{iconName}</span>
                {haven.childFriendly && (
                  <span
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 text-black border border-black flex items-center justify-center text-[9px] font-bold shadow-md z-30"
                    title="Family & Child Safe Zone"
                  >
                    👶
                  </span>
                )}
              </div>

              {/* Marker selection pointer */}
              {isSelected && (
                <div
                  className={`mt-0.5 w-2 h-2 rounded-full ${
                    isCritical ? 'bg-red-400 shadow-[0_0_8px_#ef4444]' : 'bg-blue-400 shadow-[0_0_8px_#3b82f6]'
                  }`}
                ></div>
              )}

              {/* Quick Hover Tooltip */}
              <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#050b1e]/95 border border-blue-800 text-white font-mono text-[10px] rounded-lg whitespace-nowrap shadow-xl pointer-events-none transition-opacity z-40">
                <span className="font-bold">{haven.name}</span> · {haven.distance}
              </div>
            </div>
          </div>
        );
      })}

      {/* 5. USER PRESENT LOCATION PIN ("YOU ARE HERE") */}
      {userMarkerPx && (
        <div
          style={{
            left: `${userMarkerPx.x}px`,
            top: `${userMarkerPx.y}px`,
            transform: 'translate(-50%, -50%)'
          }}
          className="absolute z-30 pointer-events-none flex flex-col items-center"
        >
          <div className="absolute -inset-4 rounded-full bg-blue-500/30 animate-ping"></div>
          <div className="w-10 h-10 rounded-full bg-[#05112e] border-2 border-blue-400 flex items-center justify-center text-blue-300 shadow-[0_0_20px_#3b82f6] z-30">
            <span className="material-symbols-outlined text-[20px] text-blue-300">
              person_pin_circle
            </span>
          </div>
          <div className="mt-1 bg-[#050b1e]/95 border border-blue-500/80 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold text-white shadow-lg whitespace-nowrap">
            YOU ARE HERE
          </div>
        </div>
      )}

      {/* 6. POPUP CARD FOR CLICKED HAVEN */}
      {activePopupHaven && (
        <div
          style={{
            left: `${selectedHavenPx ? selectedHavenPx.x : dimensions.width / 2}px`,
            top: `${selectedHavenPx ? selectedHavenPx.y - 12 : dimensions.height / 2}px`,
            transform: 'translate(-50%, -100%)'
          }}
          className="absolute z-40 p-3 max-w-xs w-72 bg-[#050b1e]/95 backdrop-blur-md text-slate-100 rounded-2xl border border-blue-500/80 shadow-2xl animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-blue-900/60">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                activePopupHaven.category === 'hospital' || activePopupHaven.category === 'fire'
                  ? 'bg-red-950 text-red-300 border border-red-800'
                  : 'bg-blue-950 text-blue-300 border border-blue-800'
              }`}
            >
              {activePopupHaven.categoryLabel}
            </span>
            <button
              onClick={() => setActivePopupHaven(null)}
              className="text-slate-400 hover:text-white"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>

          <h4 className="font-bold text-sm text-white leading-snug">{activePopupHaven.name}</h4>
          <p className="text-[11px] text-slate-400 mt-0.5 font-mono">{activePopupHaven.address}</p>

          {activePopupHaven.childFriendly && (
            <div className="mt-2 text-[10px] font-mono text-emerald-300 bg-[#02140c] p-1.5 rounded-lg border border-emerald-900/80 flex items-center gap-1">
              <span>👶 Family Safe:</span>
              <span className="font-bold">{activePopupHaven.childSafetyTags ? activePopupHaven.childSafetyTags[0] : 'Pediatric Ready'}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-xs font-mono font-bold text-blue-400 mt-2 pt-1.5 border-t border-blue-900/60">
            <span>Distance: {activePopupHaven.distance}</span>
            <span>{activePopupHaven.openBeds ? `${activePopupHaven.openBeds} Beds Free` : 'Ready'}</span>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={() => {
                playTactileClick();
                onSelectHaven(activePopupHaven);
                setActivePopupHaven(null);
              }}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-mono font-bold text-center shadow-md cursor-pointer"
            >
              Lock Tactical Route
            </button>
          </div>
        </div>
      )}

      {/* 7. STREET THEME SELECTOR PILL (Bottom Left) */}
      <div className="absolute bottom-3 left-3 z-30 bg-[#04081c]/90 backdrop-blur-md px-2 py-1 rounded-xl border border-blue-900/60 flex items-center gap-1 shadow-lg text-[10px] font-mono">
        <span className="text-slate-400 mr-1 hidden sm:inline">Theme:</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            playTactileClick();
            if (onThemeChange) onThemeChange('dark');
          }}
          className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
            styleTheme === 'dark' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          Tactical Dark
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            playTactileClick();
            if (onThemeChange) onThemeChange('osm');
          }}
          className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
            styleTheme === 'osm' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          OSM Streets
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            playTactileClick();
            if (onThemeChange) onThemeChange('satellite');
          }}
          className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
            styleTheme === 'satellite' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          Satellite
        </button>
      </div>

      {/* 8. ATTRIBUTION & LICENSE (Bottom Right) */}
      <div className="absolute bottom-1 right-2 z-30 text-[9px] font-mono text-slate-500 pointer-events-none bg-black/40 px-1.5 py-0.5 rounded">
        © OpenStreetMap · CARTO · Esri
      </div>
    </div>
  );
};
