import { useMemo } from "react";
import { GoogleMap, Circle, Marker, useJsApiLoader } from "@react-google-maps/api";
import { getGoogleMapsApiKey } from "@/services/googleMaps";
import { Loader2, MapPin } from "lucide-react";

export interface ZoneMapData {
  id: string;
  name: string;
  city: string;
  state: string;
  neighborhood: string;
  max_radius_km: number;
  is_active: boolean;
  latitude?: number;
  longitude?: number;
}

export interface DeliveryZoneMapProps {
  zones: ZoneMapData[];
  storeLat?: number;
  storeLng?: number;
  onZoneClick?: (zone: ZoneMapData) => void;
  className?: string;
}

const DEFAULT_CENTER = { lat: -15.7801, lng: -47.9292 }; // Brasília
const DEFAULT_ZOOM = 4;

const mapContainerStyle = { width: "100%", height: "100%" };

export const DeliveryZoneMap = ({
  zones,
  storeLat,
  storeLng,
  onZoneClick,
  className,
}: DeliveryZoneMapProps) => {
  const apiKey = getGoogleMapsApiKey();
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    language: "pt-BR",
  });

  const center = useMemo(() => {
    if (storeLat && storeLng) return { lat: storeLat, lng: storeLng };
    // Use first zone's city as approximate center
    return DEFAULT_CENTER;
  }, [storeLat, storeLng]);

  const fitZoom = useMemo(() => {
    return storeLat && storeLng ? 13 : zones.length > 0 ? 5 : DEFAULT_ZOOM;
  }, [storeLat, storeLng, zones.length]);

  if (!apiKey) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 ${className || ""}`}>
        <div className="text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-2 h-8 w-8" />
          <p>Configure a chave GOOGLE_MAPS_API_KEY para visualizar o mapa.</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-border bg-muted/30 ${className || ""}`}>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-border ${className || ""}`} style={{ height: 400 }}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={fitZoom}
        options={{
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          styles: [
            {
              featureType: "poi",
              elementType: "labels",
              stylers: [{ visibility: "off" }],
            },
          ],
        }}
      >
        {/* Store marker */}
        {storeLat && storeLng && (
          <Marker
            position={{ lat: storeLat, lng: storeLng }}
            icon={{
              url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23111' stroke-width='2'%3E%3Cpath d='M12 2a8 8 0 0 0-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 0 0-8-8z'/%3E%3Ccircle cx='12' cy='10' r='3' fill='%23b6ff00' stroke='%23111'/%3E%3C/svg%3E",
            }}
            title="Sua loja"
          />
        )}

        {/* Zone circles */}
        {zones.map((zone) => (
          <Circle
            key={zone.id}
            center={{
              lat: zone.latitude || center.lat,
              lng: zone.longitude || center.lng,
            }}
            radius={zone.max_radius_km * 1000}
            options={{
              fillColor: zone.is_active ? "#b6ff00" : "#9ca3af",
              fillOpacity: 0.15,
              strokeColor: zone.is_active ? "#8ce600" : "#6b7280",
              strokeWeight: 2,
              strokeOpacity: 0.6,
              clickable: !!onZoneClick,
            }}
            onClick={() => onZoneClick?.(zone)}
          />
        ))}
      </GoogleMap>
    </div>
  );
};
